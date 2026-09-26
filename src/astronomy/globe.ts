import { horizonAltitudeAt } from './horizon';
import type { SkyPoint, TerrainProfile } from '../types';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// 平均黄道傾斜角。参照リングの描画用途なので年代変化は無視する。
const OBLIQUITY = 23.4393;

/** 地平座標系の単位ベクトル。東をx、北をy、天頂をzとする右手系。 */
export interface Vector3 {
  east: number;
  north: number;
  up: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** 球面上の点の投影結果。facingが正なら視点側の半球にある。 */
export interface ProjectedPoint extends ScreenPoint {
  facing: number;
}

/** 天球儀を外から眺める視点。 */
export interface GlobeCameraState {
  /** 視点の方位。度。増やすと球面が画面右へ回る。 */
  yaw: number;
  /** 視点の仰角。度。 */
  pitch: number;
  /** 球の表示倍率。 */
  zoom: number;
}

// 南天と傾いた極軸の両方が見える斜めからの初期視点。
export const DEFAULT_GLOBE_CAMERA: GlobeCameraState = { yaw: 200, pitch: 18, zoom: 1 };
export const GLOBE_PITCH_LIMIT = 80;
export const GLOBE_ZOOM_MIN = .7;
export const GLOBE_ZOOM_MAX = 2.4;

export function dot(left: Vector3, right: Vector3) {
  return left.east * right.east + left.north * right.north + left.up * right.up;
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return {
    east: left.north * right.up - left.up * right.north,
    north: left.up * right.east - left.east * right.up,
    up: left.east * right.north - left.north * right.east,
  };
}

export function vectorFromHorizontal(altitudeDegrees: number, azimuthDegrees: number): Vector3 {
  const altitude = altitudeDegrees * DEG;
  const azimuth = azimuthDegrees * DEG;
  const horizontal = Math.cos(altitude);
  return {
    east: horizontal * Math.sin(azimuth),
    north: horizontal * Math.cos(azimuth),
    up: Math.sin(altitude),
  };
}

export function skyPointVector(point: Pick<SkyPoint, 'altitude' | 'azimuth'>) {
  return vectorFromHorizontal(point.altitude, point.azimuth);
}

/**
 * 赤道座標を地平座標系の単位ベクトルへ変換する。
 * 参照リングは幾何的な位置を示すため、大気差は加えない。
 */
function vectorFromEquatorial(
  raHours: number,
  decDegrees: number,
  siderealDegrees: number,
  latitudeDegrees: number,
): Vector3 {
  const hourAngle = (siderealDegrees - raHours * 15) * DEG;
  const dec = decDegrees * DEG;
  const latitude = latitudeDegrees * DEG;
  return {
    east: -Math.cos(dec) * Math.sin(hourAngle),
    north: Math.sin(dec) * Math.cos(latitude) - Math.cos(dec) * Math.sin(latitude) * Math.cos(hourAngle),
    up: Math.sin(dec) * Math.sin(latitude) + Math.cos(dec) * Math.cos(latitude) * Math.cos(hourAngle),
  };
}

/** 天の北極の方向。観測地の緯度だけ北の地平線から傾く。 */
export function northPoleVector(latitudeDegrees: number): Vector3 {
  return vectorFromHorizontal(latitudeDegrees, 0);
}

/** 地平環。地形プロファイルがあれば方位ごとの稜線をたどる。 */
export function horizonRingVectors(terrain?: TerrainProfile, step = 2): Vector3[] {
  const vectors: Vector3[] = [];
  for (let azimuth = 0; azimuth < 360; azimuth += step) {
    vectors.push(vectorFromHorizontal(Math.max(0, horizonAltitudeAt(azimuth, terrain)), azimuth));
  }
  return vectors;
}

/** 子午線環。天頂と南北を通る大円。 */
export function meridianRingVectors(step = 2): Vector3[] {
  const vectors: Vector3[] = [];
  for (let angle = 0; angle < 360; angle += step) {
    vectors.push({ east: 0, north: Math.cos(angle * DEG), up: Math.sin(angle * DEG) });
  }
  return vectors;
}

/** 天の赤道。 */
export function equatorRingVectors(siderealDegrees: number, latitudeDegrees: number, step = 2): Vector3[] {
  const vectors: Vector3[] = [];
  for (let angle = 0; angle < 360; angle += step) {
    vectors.push(vectorFromEquatorial(angle / 15, 0, siderealDegrees, latitudeDegrees));
  }
  return vectors;
}

/** 黄道。太陽の見かけの通り道。 */
export function eclipticRingVectors(siderealDegrees: number, latitudeDegrees: number, step = 2): Vector3[] {
  const obliquity = OBLIQUITY * DEG;
  const vectors: Vector3[] = [];
  for (let longitude = 0; longitude < 360; longitude += step) {
    const lambda = longitude * DEG;
    const ra = Math.atan2(Math.cos(obliquity) * Math.sin(lambda), Math.cos(lambda)) * RAD / 15;
    const dec = Math.asin(Math.sin(obliquity) * Math.sin(lambda)) * RAD;
    vectors.push(vectorFromEquatorial(ra, dec, siderealDegrees, latitudeDegrees));
  }
  return vectors;
}

export interface GlobeView {
  center: ScreenPoint;
  radius: number;
  /** 球の中心から視点へ向かう方向。 */
  forward: Vector3;
  /** 正射影で球面上の点を画面座標へ写す。scaleは球半径に対する倍率。 */
  project(vector: Vector3, scale?: number): ProjectedPoint;
}

export function createGlobeView(camera: GlobeCameraState, center: ScreenPoint, radius: number): GlobeView {
  const yaw = camera.yaw * DEG;
  const pitch = clampPitch(camera.pitch) * DEG;
  const forward: Vector3 = {
    east: Math.cos(pitch) * Math.sin(yaw),
    north: Math.cos(pitch) * Math.cos(yaw),
    up: Math.sin(pitch),
  };
  // 天頂を画面上方に保つため、画面右は天頂と視線の外積にとる。
  const right: Vector3 = { east: -Math.cos(yaw), north: Math.sin(yaw), up: 0 };
  const up = cross(forward, right);

  return {
    center,
    radius,
    forward,
    project(vector, scale = 1) {
      return {
        x: center.x + dot(vector, right) * radius * scale,
        y: center.y - dot(vector, up) * radius * scale,
        facing: dot(vector, forward),
      };
    },
  };
}

export function clampPitch(pitch: number) {
  return Math.max(-GLOBE_PITCH_LIMIT, Math.min(GLOBE_PITCH_LIMIT, pitch));
}

export function clampZoom(zoom: number) {
  return Math.max(GLOBE_ZOOM_MIN, Math.min(GLOBE_ZOOM_MAX, zoom));
}

/** 環を手前側と奥側の連続した区間へ分ける。線種を描き分けるために使う。 */
export interface GlobeSegment {
  points: ScreenPoint[];
  near: boolean;
}

export function splitRing(view: GlobeView, vectors: Vector3[], scale = 1): GlobeSegment[] {
  if (!vectors.length) return [];
  const projected = vectors.map((vector) => view.project(vector, scale));
  const segments: GlobeSegment[] = [];
  let current: GlobeSegment | null = null;

  for (let index = 0; index < projected.length; index += 1) {
    const point = projected[index];
    const near = point.facing >= 0;
    if (!current || current.near !== near) {
      // 境界の点は両区間に含め、手前と奥の線をつなげる。
      if (current) current.points.push({ x: point.x, y: point.y });
      current = { points: [], near };
      segments.push(current);
    }
    current.points.push({ x: point.x, y: point.y });
  }

  const first = segments[0];
  const last = segments[segments.length - 1];
  if (segments.length > 1 && first.near === last.near) {
    first.points = [...last.points, ...first.points];
    segments.pop();
  } else if (segments.length === 1) {
    // 全体が同じ側にあるので閉じる。
    first.points.push(first.points[0]);
  }
  return segments;
}
