import { useEffect, useMemo, useRef } from 'react';
import {
  createGlobeView,
  eclipticRingVectors,
  equatorRingVectors,
  horizonRingVectors,
  meridianRingVectors,
  northPoleVector,
  skyPointVector,
  splitRing,
  vectorFromHorizontal,
} from '../astronomy/globe';
import type { GlobeSegment, GlobeView, ScreenPoint, Vector3 } from '../astronomy/globe';
import { horizonAltitudeAt } from '../astronomy/horizon';
import { CONSTELLATIONS } from '../data/stars';
import { useGlobeCamera } from '../hooks/useGlobeCamera';
import type { DisplayOptions, ObservationLocation, SkyModel, SkyPoint } from '../types';

interface GlobeCanvasProps {
  sky: SkyModel;
  options: DisplayOptions;
  location: ObservationLocation;
}

/** 地平環や方位ラベルを球面より少し外側に置くための倍率。 */
const MOUNT_SCALE = 1.06;
const AXIS_SCALE = 1.16;
const BOTTOM_INSET = 78;

const COLOR = {
  limb: 'rgba(168, 198, 210, .32)',
  underground: 'rgba(2, 7, 13, .66)',
  equatorNear: 'rgba(122, 186, 198, .8)',
  equatorFar: 'rgba(122, 186, 198, .2)',
  eclipticNear: 'rgba(239, 168, 142, .78)',
  eclipticFar: 'rgba(239, 168, 142, .2)',
  mountNear: 'rgba(209, 188, 146, .82)',
  mountFar: 'rgba(209, 188, 146, .2)',
  terrain: 'rgba(129, 158, 160, .7)',
  label: 'rgba(226, 237, 243, .78)',
} as const;

type Context = CanvasRenderingContext2D;

function strokeSegments(context: Context, segments: GlobeSegment[], near: string, far: string, dash: number[] = []) {
  for (const segment of segments) {
    if (segment.points.length < 2) continue;
    context.save();
    context.strokeStyle = segment.near ? near : far;
    context.setLineDash(segment.near ? dash : [2, 4]);
    context.beginPath();
    context.moveTo(segment.points[0].x, segment.points[0].y);
    for (const point of segment.points.slice(1)) context.lineTo(point.x, point.y);
    context.stroke();
    context.restore();
  }
}

/** 手前の半球のうち地平線より下の領域を暗く塗る。 */
function fillUnderground(context: Context, view: GlobeView, horizon: Vector3[]) {
  const arc = splitRing(view, horizon)
    .filter((segment) => segment.near && segment.points.length > 1)
    .sort((left, right) => right.points.length - left.points.length)[0];
  if (!arc) return;
  const { center, radius } = view;
  const bottom = center.y + radius * 2;
  context.save();
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.clip();
  // 地平線の弧の下側を球の輪郭で切り取る。弧の向きに依存しない形で閉じる。
  context.beginPath();
  context.moveTo(arc.points[0].x, arc.points[0].y);
  for (const point of arc.points.slice(1)) context.lineTo(point.x, point.y);
  context.lineTo(arc.points[arc.points.length - 1].x, bottom);
  context.lineTo(arc.points[0].x, bottom);
  context.closePath();
  context.fillStyle = COLOR.underground;
  context.fill();
  context.restore();
}

function drawBall(context: Context, view: GlobeView, night: boolean, twilight: boolean) {
  const { center, radius } = view;
  const glow = context.createRadialGradient(center.x, center.y, radius * .92, center.x, center.y, radius * 1.4);
  glow.addColorStop(0, 'rgba(109, 171, 182, .2)');
  glow.addColorStop(1, 'rgba(109, 171, 182, 0)');
  context.fillStyle = glow;
  context.beginPath();
  context.arc(center.x, center.y, radius * 1.4, 0, Math.PI * 2);
  context.fill();

  const surface = context.createRadialGradient(
    center.x - radius * .34, center.y - radius * .4, radius * .1,
    center.x, center.y, radius * 1.05,
  );
  surface.addColorStop(0, night ? '#12293c' : twilight ? '#1d3a54' : '#38617f');
  surface.addColorStop(1, night ? '#030c17' : twilight ? '#08182a' : '#123048');
  context.fillStyle = surface;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.fill();
}

function drawStars(context: Context, view: GlobeView, stars: SkyPoint[], labels: boolean, horizonAt: (azimuth: number) => number) {
  for (const star of stars) {
    const point = view.project(skyPointVector(star));
    if (point.facing <= 0) continue;
    const buried = star.altitude < horizonAt(star.azimuth);
    const radius = Math.max(.35, 3.2 - star.magnitude * .44);
    if (!buried && radius > 1.6) {
      const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 3);
      glow.addColorStop(0, star.color);
      glow.addColorStop(.2, `${star.color}b0`);
      glow.addColorStop(1, `${star.color}00`);
      context.fillStyle = glow;
      context.beginPath();
      context.arc(point.x, point.y, radius * 3, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = buried ? .22 : Math.max(.45, 1 - Math.max(0, star.magnitude) * .055);
    context.fillStyle = star.color;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
    if (labels && star.name && !buried && star.magnitude <= 1.2) {
      context.fillStyle = COLOR.label;
      context.font = "10px 'Noto Sans JP', sans-serif";
      context.fillText(star.name, point.x + radius + 5, point.y - radius - 2);
    }
  }
}

function drawConstellations(context: Context, view: GlobeView, stars: SkyPoint[], labels: boolean) {
  const projected = new Map<string, ScreenPoint>();
  for (const star of stars) {
    if (!star.name) continue;
    const point = view.project(skyPointVector(star));
    if (point.facing > 0) projected.set(star.id, point);
  }
  context.lineWidth = .65;
  context.strokeStyle = 'rgba(136, 170, 184, .28)';
  context.fillStyle = 'rgba(154, 194, 207, .58)';
  context.font = "10px 'Noto Sans JP', sans-serif";
  for (const constellation of CONSTELLATIONS) {
    const drawn: ScreenPoint[] = [];
    for (const [from, to] of constellation.lines) {
      const start = projected.get(from);
      const end = projected.get(to);
      if (!start || !end) continue;
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      drawn.push(start, end);
    }
    if (labels && drawn.length) {
      const x = drawn.reduce((sum, point) => sum + point.x, 0) / drawn.length;
      const y = drawn.reduce((sum, point) => sum + point.y, 0) / drawn.length;
      context.fillText(constellation.name, x + 7, y - 7);
    }
  }
}

function drawBodies(context: Context, view: GlobeView, bodies: SkyPoint[], labels: boolean, horizonAt: (azimuth: number) => number) {
  for (const body of bodies) {
    const point = view.project(skyPointVector(body));
    if (point.facing <= 0) continue;
    const buried = body.altitude < horizonAt(body.azimuth);
    const radius = body.kind === 'sun' ? 13 : body.kind === 'moon' ? 10 : 3;
    context.globalAlpha = buried ? .3 : 1;
    if (!buried) {
      const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius * 2.8);
      glow.addColorStop(0, `${body.color}ee`);
      glow.addColorStop(.25, `${body.color}70`);
      glow.addColorStop(1, `${body.color}00`);
      context.fillStyle = glow;
      context.beginPath();
      context.arc(point.x, point.y, radius * 2.8, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = body.kind === 'moon' ? '#fff3d1' : body.color;
    context.beginPath();
    context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    context.fill();
    if (labels) {
      context.fillStyle = buried ? 'rgba(255, 243, 219, .45)' : 'rgba(255, 243, 219, .88)';
      context.font = "11px 'Noto Sans JP', sans-serif";
      context.fillText(body.name, point.x + radius + 6, point.y + 3);
    }
    context.globalAlpha = 1;
  }
}

/** 極軸と天の南北極。 */
function drawAxis(context: Context, view: GlobeView, latitude: number) {
  const pole = northPoleVector(latitude);
  const south: Vector3 = { east: -pole.east, north: -pole.north, up: -pole.up };
  const center = view.center;
  context.save();
  context.lineWidth = 1.6;
  for (const [vector, label] of [[pole, '天の北極'], [south, '天の南極']] as const) {
    const end = view.project(vector, AXIS_SCALE);
    const near = end.facing >= 0;
    // 球の中心から極までを半分ずつ描き、奥側は球に隠れる線として弱める。
    context.strokeStyle = near ? 'rgba(219, 199, 158, .62)' : 'rgba(219, 199, 158, .16)';
    context.setLineDash(near ? [] : [3, 4]);
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.fillStyle = near ? 'rgba(232, 214, 176, .92)' : 'rgba(232, 214, 176, .34)';
    context.beginPath();
    context.arc(end.x, end.y, 2.6, 0, Math.PI * 2);
    context.fill();
    context.font = "9px 'Noto Sans JP', sans-serif";
    context.fillText(label, end.x + 6, end.y + 3);
  }
  context.restore();
}

function drawDirections(context: Context, view: GlobeView) {
  const { center, radius } = view;
  context.save();
  context.font = "600 10px 'DM Sans', sans-serif";
  context.textAlign = 'center';
  for (const [label, azimuth] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]] as const) {
    const point = view.project(vectorFromHorizontal(0, azimuth), MOUNT_SCALE);
    // 地平環に沿った位置から、画面の外側へ少しだけ逃がす。
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    const offset = distance > radius * .3 ? 11 / distance : 0;
    context.fillStyle = point.facing >= 0 ? 'rgba(220, 233, 239, .82)' : 'rgba(220, 233, 239, .28)';
    context.fillText(
      label,
      point.x + (point.x - center.x) * offset,
      point.y + (point.y - center.y) * offset + (offset ? 4 : -6),
    );
  }
  context.restore();
}

export function GlobeCanvas({ sky, options, location }: GlobeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const { camera, isDragging, zoomBy, reset, pointerHandlers } = useGlobeCamera();

  const terrain = options.terrain ? sky.conditions.terrain : undefined;
  // 暗い星から順に描き、明るい星を上に重ねる。
  const stars = useMemo(() => [...sky.stars].sort((left, right) => right.magnitude - left.magnitude), [sky.stars]);
  const rings = useMemo(() => ({
    horizon: horizonRingVectors(undefined, 1),
    terrain: terrain ? horizonRingVectors(terrain, 2) : null,
    meridian: meridianRingVectors(),
    equator: equatorRingVectors(sky.siderealDegrees, location.latitude),
    ecliptic: eclipticRingVectors(sky.siderealDegrees, location.latitude),
  }), [sky.siderealDegrees, location.latitude, terrain]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const usableHeight = Math.max(1, height - BOTTOM_INSET);
      const center = { x: width / 2, y: usableHeight / 2 };
      const radius = Math.max(60, Math.min(width, usableHeight) / 2 - 44) * camera.zoom;
      const view = createGlobeView(camera, center, radius);
      const night = sky.sunAltitude <= -10;
      const twilight = sky.sunAltitude > -10 && sky.sunAltitude <= 0;

      const background = context.createRadialGradient(center.x, center.y, radius * .4, center.x, center.y, Math.max(width, height));
      background.addColorStop(0, '#071627');
      background.addColorStop(1, '#03080f');
      context.fillStyle = background;
      context.fillRect(0, 0, width, height);

      drawBall(context, view, night, twilight);
      fillUnderground(context, view, rings.horizon);

      context.lineWidth = 1;
      strokeSegments(context, splitRing(view, rings.equator), COLOR.equatorNear, COLOR.equatorFar, [5, 4]);
      strokeSegments(context, splitRing(view, rings.ecliptic), COLOR.eclipticNear, COLOR.eclipticFar);

      const horizonAt = (azimuth: number) => Math.max(0, horizonAltitudeAt(azimuth, terrain));
      drawStars(context, view, stars, options.labels, horizonAt);
      if (options.constellations) drawConstellations(context, view, stars, options.labels);
      if (options.planets) drawBodies(context, view, sky.bodies, options.labels, horizonAt);

      if (rings.terrain) {
        context.lineWidth = 1.2;
        strokeSegments(context, splitRing(view, rings.terrain), COLOR.terrain, 'rgba(129, 158, 160, .12)');
      }

      context.lineWidth = 1.4;
      strokeSegments(context, splitRing(view, rings.horizon, MOUNT_SCALE), COLOR.mountNear, COLOR.mountFar);
      context.lineWidth = 1;
      strokeSegments(context, splitRing(view, rings.meridian, MOUNT_SCALE), COLOR.mountNear, COLOR.mountFar);
      drawAxis(context, view, location.latitude);

      context.strokeStyle = COLOR.limb;
      context.lineWidth = 1;
      context.setLineDash([]);
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.stroke();
      drawDirections(context, view);
    };

    drawRef.current = draw;
    draw();
    const observer = new ResizeObserver(() => drawRef.current?.());
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (drawRef.current === draw) drawRef.current = null;
    };
  }, [sky, options, camera, rings, stars, terrain, location.latitude]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomBy(-event.deltaY * .001);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [zoomBy]);

  return (
    <div className="sky-canvas-wrap globe-wrap">
      <canvas
        ref={canvasRef}
        className={`sky-canvas${isDragging ? ' dragging' : ''}`}
        aria-label="指定した日時と場所の天球儀。球の外側から眺めるため星座は左右反転します。ドラッグで回転、ホイールで拡大縮小できます。"
        {...pointerHandlers}
      />
      <div className="canvas-tools" aria-label="天球儀操作">
        <button type="button" onClick={() => zoomBy(.18)} aria-label="拡大">＋</button>
        <button type="button" onClick={() => zoomBy(-.18)} aria-label="縮小">−</button>
        <button type="button" onClick={reset} aria-label="視点をリセット">↺</button>
      </div>
      <div className="globe-hud">
        <dl className="globe-legend">
          <dt className="equator" />
          <dd>天の赤道</dd>
          <dt className="ecliptic" />
          <dd>黄道</dd>
          <dt className="mount" />
          <dd>地平環・子午線環</dd>
        </dl>
        <p className="globe-readout">
          視点 方位 {Math.round(camera.yaw).toString().padStart(3, '0')}° · 仰角 {Math.round(camera.pitch)}° · 極軸の傾き {Math.abs(location.latitude).toFixed(1)}°
        </p>
      </div>
      <p className="canvas-hint"><span>↻</span> ドラッグして天球儀を回す</p>
    </div>
  );
}
