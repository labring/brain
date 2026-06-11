import {
  boundsFromRect,
  type CanvasNodeRect,
  type CanvasRectBounds,
  extendRectBounds,
  type PlacementFootprint,
  rectFromPosition,
  rectsAreOpen,
  rectsFromFootprintPosition,
  rectsIntersect,
} from "./placement-geometry";
import type { CanvasLayoutPosition } from "./types";

function cloneRect(rect: CanvasNodeRect): CanvasNodeRect {
  return {
    height: rect.height,
    width: rect.width,
    x: rect.x,
    y: rect.y,
  };
}

export class PlacementOccupancy {
  private readonly allocated: CanvasNodeRect[];
  private currentBounds: CanvasRectBounds | undefined;

  constructor(rects: readonly CanvasNodeRect[] = []) {
    this.allocated = [];
    for (const rect of rects) {
      this.allocateRect(rect);
    }
  }

  get bounds(): CanvasRectBounds | undefined {
    return this.currentBounds;
  }

  get rects(): readonly CanvasNodeRect[] {
    return this.allocated;
  }

  allocate(rects: readonly CanvasNodeRect[]): void {
    for (const rect of rects) {
      this.allocateRect(rect);
    }
  }

  allocateFootprint(
    footprint: PlacementFootprint,
    position: CanvasLayoutPosition
  ): CanvasNodeRect[] {
    const rects = rectsFromFootprintPosition(footprint, position);
    this.allocate(rects);
    return rects;
  }

  firstOpenFootprintPosition(
    candidates: readonly CanvasLayoutPosition[],
    footprint: PlacementFootprint
  ): CanvasLayoutPosition | undefined {
    return candidates.find((position) =>
      this.isFootprintOpen(footprint, position)
    );
  }

  firstOpenPosition(
    candidates: readonly CanvasLayoutPosition[],
    height: number
  ): CanvasLayoutPosition | undefined {
    return candidates.find((position) => this.isRectOpen(position, height));
  }

  isFootprintOpen(
    footprint: PlacementFootprint,
    position: CanvasLayoutPosition
  ): boolean {
    return rectsAreOpen(
      rectsFromFootprintPosition(footprint, position),
      this.allocated
    );
  }

  isRectOpen(position: CanvasLayoutPosition, height: number): boolean {
    const candidate = rectFromPosition(position, height);
    return !this.allocated.some((rect) => rectsIntersect(candidate, rect));
  }

  private allocateRect(rect: CanvasNodeRect): void {
    const next = cloneRect(rect);
    this.allocated.push(next);
    this.currentBounds =
      this.currentBounds === undefined
        ? boundsFromRect(next)
        : extendRectBounds(this.currentBounds, next);
  }
}
