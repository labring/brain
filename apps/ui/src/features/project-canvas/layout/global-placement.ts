import {
  CANVAS_NODE_FOOTPRINT_WIDTH,
  type CanvasNodeRect,
  type CanvasRectBounds,
  COLUMN_STEP,
  footprintBounds,
  type PlacementFootprint,
  ROW_STEP,
  rectsFromFootprintPosition,
} from "./placement-geometry";
import type { PlacementOccupancy } from "./placement-occupancy";
import type { CanvasLayoutPosition } from "./types";

const GLOBAL_BLOCK_COLUMNS = 3;
const GLOBAL_CANVAS_TARGET_RATIO = 2;
const GLOBAL_SHAPE_SOFT_TOLERANCE = 0.2;
const GLOBAL_EXTRA_COLUMNS = 4;
const GLOBAL_ROW_SEARCH_LIMIT = 24;

interface GlobalCandidateRows {
  currentRow: CanvasLayoutPosition[];
  futureRows: CanvasLayoutPosition[];
}

function fallbackCanvasPosition(index: number): CanvasLayoutPosition {
  return {
    x: (index % GLOBAL_BLOCK_COLUMNS) * COLUMN_STEP,
    y: Math.floor(index / GLOBAL_BLOCK_COLUMNS) * ROW_STEP,
  };
}

function paddedCanvasHeight(bounds: CanvasRectBounds): number {
  return Math.max(
    ROW_STEP,
    Math.ceil((bounds.maxY - bounds.minY) / ROW_STEP) * ROW_STEP
  );
}

function canvasShapePenalty(bounds: CanvasRectBounds): number {
  const width = Math.max(
    CANVAS_NODE_FOOTPRINT_WIDTH,
    bounds.maxX - bounds.minX
  );
  const height = paddedCanvasHeight(bounds);
  const ratio = width / height;
  return Math.abs(Math.log(ratio / GLOBAL_CANVAS_TARGET_RATIO));
}

function candidateRowIndex(rect: CanvasNodeRect, minY: number): number {
  return Math.max(0, Math.round((rect.y - minY) / ROW_STEP));
}

function globalCandidateRows(
  occupancy: PlacementOccupancy,
  footprint: PlacementFootprint
): GlobalCandidateRows {
  const bounds = occupancy.bounds;
  if (bounds === undefined) {
    return { currentRow: [{ x: 0, y: 0 }], futureRows: [] };
  }

  const maxRow = Math.max(
    ...occupancy.rects.map((rect) => candidateRowIndex(rect, bounds.minY))
  );
  const lastRowRects = occupancy.rects.filter(
    (rect) => candidateRowIndex(rect, bounds.minY) === maxRow
  );
  const lastRowRight = Math.max(
    ...lastRowRects.map((rect) => rect.x + rect.width)
  );
  const lastRowNextColumn = Math.max(
    0,
    Math.ceil((lastRowRight - bounds.minX) / COLUMN_STEP)
  );
  const footprintWidth = footprintBounds(footprint).maxX;
  const columnSpan = Math.max(1, Math.ceil(footprintWidth / COLUMN_STEP));
  const maxColumn = lastRowNextColumn + columnSpan + GLOBAL_EXTRA_COLUMNS;
  const currentRow: CanvasLayoutPosition[] = [];
  const futureRows: CanvasLayoutPosition[] = [];

  for (
    let column = lastRowNextColumn;
    column <= lastRowNextColumn + columnSpan + GLOBAL_EXTRA_COLUMNS;
    column += 1
  ) {
    currentRow.push({
      x: bounds.minX + column * COLUMN_STEP,
      y: bounds.minY + maxRow * ROW_STEP,
    });
  }

  for (
    let row = maxRow + 1;
    row <= maxRow + GLOBAL_ROW_SEARCH_LIMIT;
    row += 1
  ) {
    for (let column = 0; column <= maxColumn; column += 1) {
      futureRows.push({
        x: bounds.minX + column * COLUMN_STEP,
        y: bounds.minY + row * ROW_STEP,
      });
    }
  }

  return { currentRow, futureRows };
}

function globalCandidatePenalty(
  occupancy: PlacementOccupancy,
  footprint: PlacementFootprint,
  position: CanvasLayoutPosition
): number {
  let bounds = occupancy.bounds;
  for (const rect of rectsFromFootprintPosition(footprint, position)) {
    if (bounds === undefined) {
      bounds = {
        maxX: rect.x + rect.width,
        maxY: rect.y + rect.height,
        minX: rect.x,
        minY: rect.y,
      };
      continue;
    }
    bounds = {
      maxX: Math.max(bounds.maxX, rect.x + rect.width),
      maxY: Math.max(bounds.maxY, rect.y + rect.height),
      minX: Math.min(bounds.minX, rect.x),
      minY: Math.min(bounds.minY, rect.y),
    };
  }
  return bounds === undefined ? 0 : canvasShapePenalty(bounds);
}

export function footprintColumnSpan(footprint: PlacementFootprint): number {
  const bounds = footprintBounds(footprint);
  return Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / COLUMN_STEP));
}

/**
 * Column budget for whole-canvas regeneration: at least the widest unit,
 * otherwise sized so a filled grid approaches the same soft 2:1
 * width-to-height canvas shape Incremental Canvas Placement targets.
 */
export function regenerationColumnCap(
  footprints: readonly PlacementFootprint[],
  occupiedRects: readonly CanvasNodeRect[]
): number {
  const spans = [
    ...footprints.map(footprintColumnSpan),
    ...occupiedRects.map((rect) =>
      Math.max(1, Math.ceil(rect.width / COLUMN_STEP))
    ),
  ];
  const totalSpan = spans.reduce((sum, span) => sum + span, 0);
  const widestSpan = spans.reduce((widest, span) => Math.max(widest, span), 1);
  return Math.max(
    widestSpan,
    Math.round(
      Math.sqrt(
        (GLOBAL_CANVAS_TARGET_RATIO * totalSpan * ROW_STEP) / COLUMN_STEP
      )
    )
  );
}

/**
 * Whole-canvas regeneration placement: row-major first-open scan from the
 * grid origin bounded by the column cap, so gaps in earlier rows are
 * backfilled instead of abandoned. Incremental Canvas Placement must NOT use
 * this — ADR 0022 keeps new nodes append-only so they never fill holes in a
 * user-arranged canvas.
 */
export function firstOpenRegenerationPosition(
  occupancy: PlacementOccupancy,
  footprint: PlacementFootprint,
  columnCap: number
): CanvasLayoutPosition {
  const lastColumn = Math.max(0, columnCap - footprintColumnSpan(footprint));
  let row = 0;
  while (true) {
    for (let column = 0; column <= lastColumn; column += 1) {
      const position = { x: column * COLUMN_STEP, y: row * ROW_STEP };
      if (occupancy.isFootprintOpen(footprint, position)) {
        return position;
      }
    }
    row += 1;
  }
}

export function firstOpenGlobalPosition(
  occupancy: PlacementOccupancy,
  footprint: PlacementFootprint
): CanvasLayoutPosition {
  const candidates = globalCandidateRows(occupancy, footprint);
  const currentRow = occupancy.firstOpenFootprintPosition(
    candidates.currentRow,
    footprint
  );
  const futureRow = occupancy.firstOpenFootprintPosition(
    candidates.futureRows,
    footprint
  );

  if (currentRow !== undefined && futureRow !== undefined) {
    const currentPenalty = globalCandidatePenalty(
      occupancy,
      footprint,
      currentRow
    );
    const futurePenalty = globalCandidatePenalty(
      occupancy,
      footprint,
      futureRow
    );
    return currentPenalty <= futurePenalty + GLOBAL_SHAPE_SOFT_TOLERANCE
      ? currentRow
      : futureRow;
  }

  if (currentRow !== undefined) {
    return currentRow;
  }

  if (futureRow !== undefined) {
    return futureRow;
  }

  let index = 0;
  while (true) {
    const position = fallbackCanvasPosition(index);
    if (occupancy.isFootprintOpen(footprint, position)) {
      return position;
    }
    index += 1;
  }
}
