"use client";

import type { CanvasViewportInsets } from "@workspace/ui/components/canvas/canvas.types";
import { useCallback, useLayoutEffect, useState } from "react";

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

  useLayoutEffect(() => {
    if (root == null) {
      return;
    }

    let frame = 0;
    let resizeObserver: ResizeObserver;
    const observedElements = new WeakSet<Element>();
    const observeElement = (element: Element) => {
      if (observedElements.has(element)) {
        return;
      }
      observedElements.add(element);
      resizeObserver.observe(element);
    };
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const sidePane = activeSurfaceElement(root, '[data-slot="side-pane"]');
        const drawer = activeSurfaceElement(
          root,
          '[data-slot="exec-terminal-plane"]'
        );
        if (sidePane != null) {
          observeElement(sidePane);
        }
        if (drawer != null) {
          observeElement(drawer);
        }

        const next = measuredViewportInsets(root);
        setInsets((current) =>
          current.right === next.right && current.bottom === next.bottom
            ? current
            : next
        );
      });
    };

    resizeObserver = new ResizeObserver(measure);
    const mutationObserver = new MutationObserver(measure);
    observeElement(root);
    mutationObserver.observe(root, {
      attributes: true,
      childList: true,
      subtree: true,
    });
    measure();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [root]);

  return { insets, rootRef };
}
