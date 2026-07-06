"use client";

import { useCallback, useSyncExternalStore } from "react";
import type {
  CanvasViewportDirectiveStore,
  CanvasViewportDirectives,
} from "./canvas.types";

const NOOP_UNSUBSCRIBE = () => undefined;

/**
 * Subscribes to a host-provided viewport directive store. Returns undefined
 * when no store is provided, in which case callers fall back to the static
 * CanvasMeta viewport fields.
 */
export function useCanvasViewportDirectives(
  store: CanvasViewportDirectiveStore | undefined
): CanvasViewportDirectives | undefined {
  const subscribe = useCallback(
    (listener: () => void) =>
      store == null ? NOOP_UNSUBSCRIBE : store.subscribe(listener),
    [store]
  );
  const getSnapshot = useCallback(() => store?.getDirectives(), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
