"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { PointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useCanvasNode } from "./canvas-node.context";

const HOVER_HIDE_DELAY_MS = 100;
const HOVER_ZONE_SELECTOR = [
  '[data-slot="canvas-node-surface"]',
  '[data-slot="canvas-node-expand-button"]',
  '[data-slot="canvas-node-rf-handle"]',
].join(",");

type CanvasNodeHoverZone = "connection" | "expand-control" | "surface";

function getCanvasNodeHoverZone(
  currentTarget: HTMLElement,
  target: EventTarget | null
): CanvasNodeHoverZone | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const hoverEl = target.closest(HOVER_ZONE_SELECTOR);

  if (!(hoverEl instanceof HTMLElement && currentTarget.contains(hoverEl))) {
    return null;
  }

  switch (hoverEl.dataset.slot) {
    case "canvas-node-rf-handle":
      return "connection";
    case "canvas-node-expand-button":
      return "expand-control";
    case "canvas-node-surface":
      return "surface";
    default:
      return null;
  }
}

export function CanvasNodeFrame({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const {
    meta: { expanded },
    state: { interaction },
  } = useCanvasNode();
  const selected = interaction?.selected ?? false;
  const dragging = interaction?.dragging ?? false;
  const connectable = interaction?.connectable ?? true;
  const highlightedConnectionSide = interaction?.highlightedConnectionSide;
  const [hoverIntent, setHoverIntent] = useState(false);
  const hoverIntentRef = useRef(false);
  const hoverIntentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const setResolvedHoverIntent = useCallback((nextHoverIntent: boolean) => {
    hoverIntentRef.current = nextHoverIntent;
    setHoverIntent((currentHoverIntent) =>
      currentHoverIntent === nextHoverIntent
        ? currentHoverIntent
        : nextHoverIntent
    );
  }, []);

  const clearHoverIntentTimer = useCallback(() => {
    if (!hoverIntentTimerRef.current) {
      return;
    }

    clearTimeout(hoverIntentTimerRef.current);
    hoverIntentTimerRef.current = null;
  }, []);

  const showHoverIntent = useCallback(() => {
    clearHoverIntentTimer();

    if (dragging) {
      setResolvedHoverIntent(false);
      return;
    }

    setResolvedHoverIntent(true);
  }, [clearHoverIntentTimer, dragging, setResolvedHoverIntent]);

  const hideHoverIntent = useCallback(() => {
    clearHoverIntentTimer();
    setResolvedHoverIntent(false);
  }, [clearHoverIntentTimer, setResolvedHoverIntent]);

  const scheduleHideHoverIntent = useCallback(() => {
    if (!hoverIntentRef.current) {
      return;
    }

    clearHoverIntentTimer();
    hoverIntentTimerRef.current = setTimeout(() => {
      hoverIntentTimerRef.current = null;
      setResolvedHoverIntent(false);
    }, HOVER_HIDE_DELAY_MS);
  }, [clearHoverIntentTimer, setResolvedHoverIntent]);

  const handleHoverPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== "mouse") {
        return;
      }

      const hoverZone = getCanvasNodeHoverZone(
        event.currentTarget,
        event.target
      );

      if (hoverZone === "surface" || hoverZone === "connection") {
        showHoverIntent();
        return;
      }

      if (hoverIntentRef.current && hoverZone === "expand-control") {
        clearHoverIntentTimer();
        setResolvedHoverIntent(true);
        return;
      }

      scheduleHideHoverIntent();
    },
    [
      clearHoverIntentTimer,
      scheduleHideHoverIntent,
      setResolvedHoverIntent,
      showHoverIntent,
    ]
  );

  useEffect(() => {
    if (dragging) {
      hideHoverIntent();
    }
  }, [dragging, hideHoverIntent]);

  useEffect(() => () => clearHoverIntentTimer(), [clearHoverIntentTimer]);

  return (
    <div
      className={cn("canvas-node-frame relative", className)}
      data-connectable={connectable || undefined}
      data-dragging={dragging || undefined}
      data-highlighted-connection-side={highlightedConnectionSide}
      data-hover-intent={hoverIntent || undefined}
      data-selected={selected || undefined}
      data-slot="canvas-node-frame"
      data-state={expanded ? "expanded" : "collapsed"}
      onPointerLeave={scheduleHideHoverIntent}
      onPointerMove={handleHoverPointer}
      onPointerOver={handleHoverPointer}
    >
      {children}
    </div>
  );
}
