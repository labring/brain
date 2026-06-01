import type { Node, Viewport } from "@xyflow/react";

export interface CanvasViewportFocusNodeBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ResolveCanvasViewportFocusOptions {
  flowHeight: number;
  flowWidth: number;
  maxZoom: number;
  minZoom: number;
  node: CanvasViewportFocusNodeBounds;
  rightInset: number;
  viewport: Viewport;
}

export type CanvasViewportFocusAction =
  | {
      kind: "setViewport";
      viewport: Viewport;
    }
  | { kind: "none" };

export function nodeBoundsForViewportFocus(
  node: Node
): CanvasViewportFocusNodeBounds {
  return {
    height: node.measured?.height ?? node.height ?? 0,
    width: node.measured?.width ?? node.width ?? 0,
    x: node.position.x,
    y: node.position.y,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveCanvasViewportFocus({
  flowHeight,
  flowWidth,
  maxZoom,
  minZoom,
  node,
  rightInset,
  viewport,
}: ResolveCanvasViewportFocusOptions): CanvasViewportFocusAction {
  if (
    flowHeight <= 0 ||
    flowWidth <= 0 ||
    node.height < 0 ||
    node.width < 0 ||
    minZoom <= 0 ||
    maxZoom <= 0
  ) {
    return { kind: "none" };
  }

  const visibleWidth = flowWidth - clamp(rightInset, 0, flowWidth);
  if (visibleWidth <= 0) {
    return { kind: "none" };
  }

  const lowerZoom = Math.min(minZoom, maxZoom);
  const upperZoom = Math.max(minZoom, maxZoom);
  const zoom = clamp(viewport.zoom, lowerZoom, upperZoom);
  const targetX = visibleWidth / 2;
  const targetY = flowHeight / 2;
  const nodeCenterX = node.x + node.width / 2;
  const nodeCenterY = node.y + node.height / 2;

  return {
    kind: "setViewport",
    viewport: {
      x: targetX - nodeCenterX * zoom,
      y: targetY - nodeCenterY * zoom,
      zoom,
    },
  };
}
