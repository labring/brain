"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * FLIP the centered explorer column when the side-pane reserve snaps: the new
 * layout (width, container-query padding) lands in a single pass instead of
 * per animation frame, then the column glides from its old position in sync
 * with the pane's motion. Position is measured via `offsetLeft` so the
 * in-flight transform never skews the baseline.
 */
export function useSidePaneReserveFlip(sidePaneOpen: boolean) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevLeftRef = useRef<number | null>(null);
  const prevOpenRef = useRef(sidePaneOpen);

  useEffect(() => {
    const container = containerRef.current;
    if (container == null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      const column = container.firstElementChild;
      if (column instanceof HTMLElement) {
        prevLeftRef.current = column.offsetLeft;
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (prevOpenRef.current === sidePaneOpen) {
      return;
    }
    prevOpenRef.current = sidePaneOpen;
    const column = containerRef.current?.firstElementChild;
    if (!(column instanceof HTMLElement)) {
      return;
    }
    const newLeft = column.offsetLeft;
    const prevLeft = prevLeftRef.current;
    prevLeftRef.current = newLeft;
    if (prevLeft == null || prevLeft === newLeft) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    column.style.transition = "none";
    column.style.transform = `translateX(${prevLeft - newLeft}px)`;
    // Flush the inverted position so the next assignment animates from it.
    column.getBoundingClientRect();
    column.style.transition =
      "transform var(--project-surface-motion-enter-duration) var(--project-surface-motion-ease)";
    column.style.transform = "";
  }, [sidePaneOpen]);

  return containerRef;
}
