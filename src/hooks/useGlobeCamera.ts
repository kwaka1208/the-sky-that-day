import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_GLOBE_CAMERA, clampPitch, clampZoom } from '../astronomy/globe';
import type { GlobeCameraState } from '../astronomy/globe';

const YAW_PER_PIXEL = .34;
const PITCH_PER_PIXEL = .26;

export interface GlobeCameraController {
  camera: GlobeCameraState;
  isDragging: boolean;
  zoomBy(delta: number): void;
  reset(): void;
  pointerHandlers: {
    onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
    onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
    onPointerUp(): void;
    onPointerCancel(): void;
  };
}

/** 天球儀をドラッグとズームで眺めるための視点状態。 */
export function useGlobeCamera(): GlobeCameraController {
  const [camera, setCamera] = useState<GlobeCameraState>(DEFAULT_GLOBE_CAMERA);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  const zoomBy = useCallback((delta: number) => {
    setCamera((current) => ({ ...current, zoom: clampZoom(current.zoom + delta) }));
  }, []);

  const reset = useCallback(() => setCamera(DEFAULT_GLOBE_CAMERA), []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setIsDragging(true);
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // ボタンが離れた通知を取りこぼしても回転が続かないようにする。
    if (event.buttons === 0) {
      endDrag();
      return;
    }
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setCamera((current) => ({
      ...current,
      // ドラッグした方向へ球面が動くよう符号を合わせる。
      yaw: ((current.yaw + deltaX * YAW_PER_PIXEL) % 360 + 360) % 360,
      pitch: clampPitch(current.pitch + deltaY * PITCH_PER_PIXEL),
    }));
  }, [endDrag]);

  return {
    camera,
    isDragging,
    zoomBy,
    reset,
    pointerHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
  };
}
