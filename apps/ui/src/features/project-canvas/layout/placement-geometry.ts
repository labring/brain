import type { CanvasLayoutPosition } from "./types";

export const CANVAS_NODE_FALLBACK_WIDTH = 272;
export const CANVAS_NODE_FALLBACK_HEIGHT = 62;

export const CANVAS_NODE_FOOTPRINT_WIDTH = CANVAS_NODE_FALLBACK_WIDTH;
export const CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED =
  CANVAS_NODE_FALLBACK_HEIGHT;
/**
 * Pre-measurement fallback only: card heights are content-driven, so real
 * heights come from `node.measured` and must win over this constant. Sized
 * above the tallest known expanded card so fallback placement never overlaps.
 */
export const CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED = 300;
/** Minimum vertical clearance between stacked cards inside a cluster. */
export const CANVAS_NODE_VERTICAL_GAP = 60;
export const COLUMN_STEP = 340;
export const ROW_STEP = 280;
export const PUBLIC_ACCESS_AP_LEFT_OFFSET = COLUMN_STEP;

export interface CanvasNodeRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface CanvasRectBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

export interface PlacementFootprint {
  rects: CanvasNodeRect[];
}

export function rectFromPosition(
  position: CanvasLayoutPosition,
  height = CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED
): CanvasNodeRect {
  return {
    height,
    width: CANVAS_NODE_FOOTPRINT_WIDTH,
    x: position.x,
    y: position.y,
  };
}

export function singleNodeFootprint(height: number): PlacementFootprint {
  return { rects: [rectFromPosition({ x: 0, y: 0 }, height)] };
}

export function boundsFromRect(rect: CanvasNodeRect): CanvasRectBounds {
  return {
    maxX: rect.x + rect.width,
    maxY: rect.y + rect.height,
    minX: rect.x,
    minY: rect.y,
  };
}

export function extendRectBounds(
  bounds: CanvasRectBounds,
  rect: CanvasNodeRect
): CanvasRectBounds {
  return {
    maxX: Math.max(bounds.maxX, rect.x + rect.width),
    maxY: Math.max(bounds.maxY, rect.y + rect.height),
    minX: Math.min(bounds.minX, rect.x),
    minY: Math.min(bounds.minY, rect.y),
  };
}

export function rectBounds(rects: readonly CanvasNodeRect[]): CanvasRectBounds {
  return {
    maxX: Math.max(...rects.map((rect) => rect.x + rect.width)),
    maxY: Math.max(...rects.map((rect) => rect.y + rect.height)),
    minX: Math.min(...rects.map((rect) => rect.x)),
    minY: Math.min(...rects.map((rect) => rect.y)),
  };
}

export function footprintBounds(
  footprint: PlacementFootprint
): CanvasRectBounds {
  return rectBounds(footprint.rects);
}

export function rectsFromFootprintPosition(
  footprint: PlacementFootprint,
  position: CanvasLayoutPosition
): CanvasNodeRect[] {
  return footprint.rects.map((rect) => ({
    height: rect.height,
    width: rect.width,
    x: position.x + rect.x,
    y: position.y + rect.y,
  }));
}

export function rectsIntersect(a: CanvasNodeRect, b: CanvasNodeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function rectsAreOpen(
  rects: readonly CanvasNodeRect[],
  allocated: readonly CanvasNodeRect[]
): boolean {
  return rects.every(
    (candidate) => !allocated.some((rect) => rectsIntersect(candidate, rect))
  );
}
