import { canvasResourceKey } from "../nodes/resource-identity";
import type { PlacementAnchor, PlacementDirection } from "./placement-anchors";
import {
  COLUMN_STEP,
  type PlacementFootprint,
  ROW_STEP,
} from "./placement-geometry";
import type { PlacementOccupancy } from "./placement-occupancy";
import type { CanvasLayoutPosition } from "./types";

function positionForAnchorCandidate(
  anchor: CanvasLayoutPosition,
  offset: CanvasLayoutPosition
): CanvasLayoutPosition {
  return { x: anchor.x + offset.x, y: anchor.y + offset.y };
}

function rightAnchorOffsets(): CanvasLayoutPosition[] {
  return [
    { x: COLUMN_STEP, y: 0 },
    { x: COLUMN_STEP, y: -ROW_STEP },
    { x: COLUMN_STEP, y: ROW_STEP },
    { x: 0, y: ROW_STEP },
    { x: 0, y: -ROW_STEP },
    { x: -COLUMN_STEP, y: 0 },
  ];
}

function leftAnchorOffsets(): CanvasLayoutPosition[] {
  return [
    { x: -COLUMN_STEP, y: 0 },
    { x: -COLUMN_STEP, y: -ROW_STEP },
    { x: -COLUMN_STEP, y: ROW_STEP },
    { x: 0, y: ROW_STEP },
    { x: 0, y: -ROW_STEP },
    { x: COLUMN_STEP, y: 0 },
  ];
}

function anchorOffsets(direction: PlacementDirection): CanvasLayoutPosition[] {
  return direction === "left" ? leftAnchorOffsets() : rightAnchorOffsets();
}

export function anchorCandidatePositions(
  anchor: PlacementAnchor,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>
): CanvasLayoutPosition[] {
  const anchorPosition = positionByRef.get(canvasResourceKey(anchor.ref));
  if (anchorPosition === undefined) {
    return [];
  }
  return anchorOffsets(anchor.direction).map((offset) =>
    positionForAnchorCandidate(anchorPosition, offset)
  );
}

function anchoredPosition(
  anchor: PlacementAnchor,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy,
  footprint: PlacementFootprint
): CanvasLayoutPosition | undefined {
  return anchorCandidatePositions(anchor, positionByRef).find((position) =>
    occupancy.isFootprintOpen(footprint, position)
  );
}

export function firstAnchoredPosition(
  anchors: readonly PlacementAnchor[],
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy,
  footprint: PlacementFootprint
): CanvasLayoutPosition | undefined {
  for (const anchor of anchors) {
    const position = anchoredPosition(
      anchor,
      positionByRef,
      occupancy,
      footprint
    );
    if (position !== undefined) {
      return position;
    }
  }
  return undefined;
}
