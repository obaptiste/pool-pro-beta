import { useCallback, useRef, useState } from 'react';

interface UseLongPressOptions {
  /** Fired once the pointer has been held down past `thresholdMs`. */
  onLongPress: () => void;
  /** Fired on a normal (short) click/tap that didn't trigger the long press. */
  onClick?: () => void;
  thresholdMs?: number;
  /** Pointer movement (px) beyond which a held press is cancelled. */
  moveTolerancePx?: number;
}

export interface LongPressHandlers {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Long-press gesture via Pointer Events (covers touch, mouse, and pen).
 * Also exposes an Enter/Space keyboard trigger so the same action is
 * reachable without a touch/mouse hold.
 */
export function useLongPress({
  onLongPress,
  onClick,
  thresholdMs = 550,
  moveTolerancePx = 10,
}: UseLongPressOptions): { handlers: LongPressHandlers; isPressing: boolean } {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPos = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);
  const [isPressing, setIsPressing] = useState(false);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startPos.current = null;
    setIsPressing(false);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return; // primary button/touch/pen only
    firedRef.current = false;
    startPos.current = { x: e.clientX, y: e.clientY };
    setIsPressing(true);
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setIsPressing(false);
      onLongPress();
    }, thresholdMs);
  }, [onLongPress, thresholdMs]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startPos.current) return;
    const dx = e.clientX - startPos.current.x;
    const dy = e.clientY - startPos.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > moveTolerancePx) clear();
  }, [clear, moveTolerancePx]);

  const onPointerUp = useCallback(() => {
    const wasLongPress = firedRef.current;
    clear();
    if (!wasLongPress) onClick?.();
  }, [clear, onClick]);

  const onPointerLeave = useCallback(() => clear(), [clear]);
  const onPointerCancel = useCallback(() => clear(), [clear]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    // Suppress the native long-press context menu on touch devices.
    e.preventDefault();
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ignore Enter/Space bubbled up from a nested interactive child (e.g. an
    // "Amend"/"Delete" button inside a long-press-enabled row) — only the
    // element these handlers are bound to should trigger the long press.
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onLongPress();
    }
  }, [onLongPress]);

  return {
    handlers: { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, onPointerMove, onContextMenu, onKeyDown },
    isPressing,
  };
}
