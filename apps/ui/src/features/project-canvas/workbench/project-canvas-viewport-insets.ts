"use client";

import type { CanvasViewportInsets } from "@workspace/ui/components/canvas/canvas.types";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

const PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET = 640;
const PROJECT_CANVAS_SESSION_DRAWER_BOTTOM_INSET = 288;

function activeSurfaceElement(
  root: HTMLElement,
  selector: string
): HTMLElement | null {
  const element = root.querySelector<HTMLElement>(selector);
  if (element == null || element.getAttribute("aria-hidden") === "true") {
    return null;
  }
  return element;
}

function measuredViewportInsets(
  root: HTMLElement
): Required<CanvasViewportInsets> {
  const rootRect = root.getBoundingClientRect();
  const sidePane = activeSurfaceElement(root, '[data-slot="side-pane"]');
  const drawer = activeSurfaceElement(
    root,
    '[data-slot="exec-terminal-plane"]'
  );
  const sideRect = sidePane?.getBoundingClientRect();
  const drawerRect = drawer?.getBoundingClientRect();

  return {
    bottom:
      drawerRect == null
        ? 0
        : Math.max(
            0,
            Math.min(rootRect.height, rootRect.bottom - drawerRect.top)
          ),
    right:
      sideRect == null
        ? 0
        : Math.max(0, Math.min(rootRect.width, rootRect.right - sideRect.left)),
  };
}

export function useProjectCanvasViewportInsets(input: {
  drawerOpen: boolean;
  sideOpen: boolean;
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const rootRef = useCallback((node: HTMLDivElement | null) => {
    setRoot(node);
  }, []);
  const [insets, setInsets] = useState<Required<CanvasViewportInsets>>(() => ({
    bottom: input.drawerOpen ? PROJECT_CANVAS_SESSION_DRAWER_BOTTOM_INSET : 0,
    right: input.sideOpen ? PROJECT_CANVAS_SIDE_PANE_RIGHT_INSET : 0,
  }));

  const drawerOpen = input.drawerOpen;
  const sideOpen = input.sideOpen;
  const measureRef = useRef<(() => void) | null>(null);

  // Observation is scoped to the two surface elements (plus the root's size):
  // surface presence changes arrive through the `drawerOpen`/`sideOpen` props,
  // surface open/close flips through their own attributes, and their settled
  // positions through `transitionend` — never through whole-subtree mutations.
  useLayoutEffect(() => {
    if (root == null) {
      return;
    }

    let frame = 0;
    let resizeObserver: ResizeObserver;
    let surfaceAttributeObserver: MutationObserver;
    const observedElements = new WeakSet<Element>();
    const observeSurface = (element: Element) => {
      if (observedElements.has(element)) {
        return;
      }
      observedElements.add(element);
      resizeObserver.observe(element);
      surfaceAttributeObserver.observe(element, {
        attributeFilter: ["aria-hidden", "class", "style"],
      });
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const sidePane = root.querySelector('[data-slot="side-pane"]');
        const drawer = root.querySelector('[data-slot="exec-terminal-plane"]');
        if (sidePane != null) {
          observeSurface(sidePane);
        }
        if (drawer != null) {
          observeSurface(drawer);
        }

        const next = measuredViewportInsets(root);
        setInsets((current) =>
          current.right === next.right && current.bottom === next.bottom
            ? current
            : next
        );
      });
    };
    const onTransitionEnd = (event: TransitionEvent) => {
      if (
        event.propertyName !== "transform" &&
        event.propertyName !== "opacity"
      ) {
        return;
      }
      if (
        event.target instanceof Element &&
        event.target.closest(
          '[data-slot="side-pane"], [data-slot="exec-terminal-plane"]'
        ) != null
      ) {
        measure();
      }
    };

    resizeObserver = new ResizeObserver(measure);
    surfaceAttributeObserver = new MutationObserver(measure);
    resizeObserver.observe(root);
    root.addEventListener("transitionend", onTransitionEnd, true);
    measureRef.current = measure;
    measure();

    return () => {
      measureRef.current = null;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      surfaceAttributeObserver.disconnect();
      root.removeEventListener("transitionend", onTransitionEnd, true);
    };
  }, [root]);

  useLayoutEffect(() => {
    if (drawerOpen || sideOpen) {
      measureRef.current?.();
    }
  }, [drawerOpen, sideOpen]);

  return { insets, rootRef };
}
