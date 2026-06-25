import type { Node, Viewport } from "@xyflow/react";

export interface CanvasViewportFocusNodeBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ResolveCanvasViewportFocusOptions {
  bottomInset?: number;
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

export function nodesBoundsForViewportFocus(
  nodes: readonly Node[]
): CanvasViewportFocusNodeBounds | null {
  if (nodes.length === 0) {
    return null;
  }

  const bounds = nodes.map(nodeBoundsForViewportFocus);
  const minX = Math.min(...bounds.map((item) => item.x));
  const minY = Math.min(...bounds.map((item) => item.y));
  const maxX = Math.max(...bounds.map((item) => item.x + item.width));
  const maxY = Math.max(...bounds.map((item) => item.y + item.height));

  return {
    height: maxY - minY,
    width: maxX - minX,
    x: minX,
    y: minY,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function fitZoomForDimension(input: {
  available: number;
  current: number;
  size: number;
}): number {
  if (input.size <= 0) {
    return input.current;
  }
  return Math.min(input.current, input.available / input.size);
}

export function resolveCanvasViewportFocus({
  bottomInset = 0,
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
  const visibleHeight = flowHeight - clamp(bottomInset, 0, flowHeight);
  if (visibleWidth <= 0 || visibleHeight <= 0) {
    return { kind: "none" };
  }

  const lowerZoom = Math.min(minZoom, maxZoom);
  const upperZoom = Math.max(minZoom, maxZoom);
  const currentZoom = clamp(viewport.zoom, lowerZoom, upperZoom);
  const zoom = clamp(
    fitZoomForDimension({
      available: visibleHeight,
      current: fitZoomForDimension({
        available: visibleWidth,
        current: currentZoom,
        size: node.width,
      }),
      size: node.height,
    }),
    lowerZoom,
    upperZoom
  );
  const targetX = visibleWidth / 2;
  const targetY = visibleHeight / 2;
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
