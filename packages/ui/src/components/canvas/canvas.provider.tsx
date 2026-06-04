"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasContext } from "./canvas.context";
import type {
  CanvasContextValue,
  CanvasInteractionMode,
  CanvasMeta,
  CanvasState,
} from "./canvas.types";

const NAVIGATION_CHROME_IDLE_MS = 1200;

export function CanvasProvider({
  children,
  meta,
  state,
}: {
  children: ReactNode;
  meta?: CanvasMeta;
  state: CanvasState;
}) {
  const defaultInteractionMode: CanvasInteractionMode =
    meta?.defaultInteractionMode ?? "pointer";
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>(
    defaultInteractionMode
  );
  const [navigationChromeVisible, setNavigationChromeVisible] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const navigationChromeHoldCountRef = useRef(0);
  const navigationChromeIdleTimerRef = useRef<number | null>(null);

  const clearNavigationChromeIdleTimer = useCallback(() => {
    if (navigationChromeIdleTimerRef.current === null) {
      return;
    }
    window.clearTimeout(navigationChromeIdleTimerRef.current);
    navigationChromeIdleTimerRef.current = null;
  }, []);

  const scheduleNavigationChromeIdle = useCallback(() => {
    clearNavigationChromeIdleTimer();
    if (navigationChromeHoldCountRef.current > 0) {
      return;
    }
    navigationChromeIdleTimerRef.current = window.setTimeout(() => {
      navigationChromeIdleTimerRef.current = null;
      if (navigationChromeHoldCountRef.current === 0) {
        setNavigationChromeVisible(false);
      }
    }, NAVIGATION_CHROME_IDLE_MS);
  }, [clearNavigationChromeIdleTimer]);

  const beginNavigationChromeInteraction = useCallback(() => {
    clearNavigationChromeIdleTimer();
    navigationChromeHoldCountRef.current += 1;
    setNavigationChromeVisible(true);
  }, [clearNavigationChromeIdleTimer]);

  const endNavigationChromeInteraction = useCallback(() => {
    navigationChromeHoldCountRef.current = Math.max(
      0,
      navigationChromeHoldCountRef.current - 1
    );
    scheduleNavigationChromeIdle();
  }, [scheduleNavigationChromeIdle]);

  const revealNavigationChrome = useCallback(() => {
    setNavigationChromeVisible(true);
    scheduleNavigationChromeIdle();
  }, [scheduleNavigationChromeIdle]);

  useEffect(() => {
    setInteractionMode(defaultInteractionMode);
  }, [defaultInteractionMode]);

  useEffect(
    () => () => {
      clearNavigationChromeIdleTimer();
    },
    [clearNavigationChromeIdleTimer]
  );

  const value = useMemo<CanvasContextValue>(
    () => ({
      interactionMode,
      meta: meta ?? {},
      navigationChrome: {
        beginInteraction: beginNavigationChromeInteraction,
        endInteraction: endNavigationChromeInteraction,
        reveal: revealNavigationChrome,
        visible: navigationChromeVisible,
      },
      rootRef,
      setInteractionMode,
      state,
    }),
    [
      beginNavigationChromeInteraction,
      endNavigationChromeInteraction,
      interactionMode,
      meta,
      navigationChromeVisible,
      revealNavigationChrome,
      state,
    ]
  );

  return <CanvasContext value={value}>{children}</CanvasContext>;
}
