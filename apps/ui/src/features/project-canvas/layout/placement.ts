import type { Node } from "@xyflow/react";

import type { CanvasDetectedConnection } from "../flow/detected-connections";
import {
  canvasEntryPointApResourceIdentityFromNode,
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasLayoutResourceRef,
} from "./types";

export const CANVAS_NODE_FALLBACK_WIDTH = 272;
export const CANVAS_NODE_FALLBACK_HEIGHT = 62;

const GLOBAL_BLOCK_COLUMNS = 3;
const GLOBAL_BLOCK_ROWS = 3;
const GLOBAL_RIGHT_BLOCKS = 2;
const CANVAS_NODE_FOOTPRINT_WIDTH = CANVAS_NODE_FALLBACK_WIDTH;
const CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED = CANVAS_NODE_FALLBACK_HEIGHT;
const CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED = 220;
const COLUMN_STEP = 340;
const ROW_STEP = 280;
const BLOCK_COLUMN_STEP = GLOBAL_BLOCK_COLUMNS * COLUMN_STEP;
const BLOCK_ROW_STEP = GLOBAL_BLOCK_ROWS * ROW_STEP;
const ENTRY_POINT_AP_LEFT_OFFSET = COLUMN_STEP;
const GENERATED_POSITION_SOURCE = "generated";

export interface PlaceCanvasNodesOptions {
  connections?: readonly CanvasDetectedConnection[];
  layout: CanvasLayoutDocument | undefined;
  nodes: Node[];
}

export interface PlaceCanvasNodesResult {
  nodes: Node[];
  placedLayoutNodes: CanvasLayoutNode[];
}

interface CanvasNodeRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface PlacementCandidate {
  index: number;
  node: Node;
  ref: CanvasLayoutResourceRef | undefined;
  sortKey: string;
}

type PlacementDirection = "left" | "right";

interface PlacementAnchor {
  direction: PlacementDirection;
  ref: CanvasLayoutResourceRef;
}

function fallbackCanvasPosition(index: number): CanvasLayoutPosition {
  return {
    x: (index % GLOBAL_BLOCK_COLUMNS) * COLUMN_STEP,
    y: Math.floor(index / GLOBAL_BLOCK_COLUMNS) * ROW_STEP,
  };
}

function rectFromPosition(
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

function rectsIntersect(a: CanvasNodeRect, b: CanvasNodeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function isNodeExpanded(node: Node): boolean {
  const layout = asRecord(asRecord(node.data)?.layout);
  return layout?.expanded === true;
}

function layoutNodeFootprintHeight(node: CanvasLayoutNode): number {
  return node.expanded === true
    ? CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED
    : CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED;
}

function nodeFootprintHeight(node: Node): number {
  return isNodeExpanded(node)
    ? CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED
    : CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED;
}

export function isCanvasNodeGeneratedPosition(node: Node | undefined): boolean {
  const layout = asRecord(asRecord(node?.data)?.layout);
  return layout?.positionSource === GENERATED_POSITION_SOURCE;
}

function comparePlacementCandidates(
  a: PlacementCandidate,
  b: PlacementCandidate
): number {
  return a.sortKey.localeCompare(b.sortKey);
}

function nodeWithPosition(node: Node, position: CanvasLayoutPosition): Node {
  return {
    ...node,
    position: { x: position.x, y: position.y },
  };
}

function nodeWithGeneratedPosition(
  node: Node,
  position: CanvasLayoutPosition
): Node {
  const data = asRecord(node.data) ?? {};
  const layout = asRecord(data.layout) ?? {};
  return {
    ...nodeWithPosition(node, position),
    data: {
      ...data,
      layout: {
        ...layout,
        generatedPosition: { x: position.x, y: position.y },
        positionSource: GENERATED_POSITION_SOURCE,
      },
    },
  };
}

function layoutNodeFromPlacedNode(
  node: Node,
  ref: CanvasLayoutResourceRef,
  position: CanvasLayoutPosition
): CanvasLayoutNode {
  const data = asRecord(node.data);
  const layout = asRecord(data?.layout);
  const expanded =
    typeof layout?.expanded === "boolean" ? layout.expanded : false;
  return {
    expanded,
    position: { x: position.x, y: position.y },
    ref,
  };
}

function positionForAnchorCandidate(
  anchor: CanvasLayoutPosition,
  offset: CanvasLayoutPosition
): CanvasLayoutPosition {
  return { x: anchor.x + offset.x, y: anchor.y + offset.y };
}

function entryPointAnchorOffsets(): CanvasLayoutPosition[] {
  return [
    { x: -ENTRY_POINT_AP_LEFT_OFFSET, y: 0 },
    { x: -ENTRY_POINT_AP_LEFT_OFFSET, y: -ROW_STEP },
    { x: -ENTRY_POINT_AP_LEFT_OFFSET, y: ROW_STEP },
    { x: 0, y: -ROW_STEP },
    { x: 0, y: ROW_STEP },
    { x: COLUMN_STEP, y: 0 },
  ];
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

function globalBlockOrigins(
  allocated: readonly CanvasNodeRect[]
): CanvasLayoutPosition[] {
  if (allocated.length === 0) {
    return [{ x: 0, y: 0 }];
  }

  const minX = Math.min(...allocated.map((rect) => rect.x));
  const minY = Math.min(...allocated.map((rect) => rect.y));
  const maxX = Math.max(...allocated.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...allocated.map((rect) => rect.y + rect.height));
  const rightX = minX + Math.ceil((maxX - minX) / COLUMN_STEP) * COLUMN_STEP;
  const belowY = minY + Math.ceil((maxY - minY) / ROW_STEP) * ROW_STEP;
  const origins: CanvasLayoutPosition[] = [];

  for (let block = 0; block < GLOBAL_RIGHT_BLOCKS; block += 1) {
    origins.push({ x: rightX, y: minY + block * BLOCK_ROW_STEP });
  }

  for (let row = 0; row < 16; row += 1) {
    for (let column = 0; column < GLOBAL_RIGHT_BLOCKS; column += 1) {
      origins.push({
        x: minX + column * BLOCK_COLUMN_STEP,
        y: belowY + row * BLOCK_ROW_STEP,
      });
    }
  }

  return origins;
}

function blockCandidatePositions(
  origin: CanvasLayoutPosition
): CanvasLayoutPosition[] {
  const positions: CanvasLayoutPosition[] = [];
  for (let row = 0; row < GLOBAL_BLOCK_ROWS; row += 1) {
    for (let column = 0; column < GLOBAL_BLOCK_COLUMNS; column += 1) {
      positions.push({
        x: origin.x + column * COLUMN_STEP,
        y: origin.y + row * ROW_STEP,
      });
    }
  }
  return positions;
}

function firstOpenPosition(
  candidates: readonly CanvasLayoutPosition[],
  allocated: readonly CanvasNodeRect[],
  height: number
): CanvasLayoutPosition | undefined {
  return candidates.find((position) => {
    const candidate = rectFromPosition(position, height);
    return !allocated.some((rect) => rectsIntersect(candidate, rect));
  });
}

function firstOpenGlobalPosition(
  origins: readonly CanvasLayoutPosition[],
  allocated: readonly CanvasNodeRect[],
  height: number
): CanvasLayoutPosition {
  for (const origin of origins) {
    const position = firstOpenPosition(
      blockCandidatePositions(origin),
      allocated,
      height
    );
    if (position !== undefined) {
      return position;
    }
  }

  let index = 0;
  while (true) {
    const position = fallbackCanvasPosition(index);
    const candidate = rectFromPosition(position, height);
    if (!allocated.some((rect) => rectsIntersect(candidate, rect))) {
      return position;
    }
    index += 1;
  }
}

function connectionAnchorsForRef(
  ref: CanvasLayoutResourceRef,
  connections: readonly CanvasDetectedConnection[] | undefined
): PlacementAnchor[] {
  const anchors: PlacementAnchor[] = [];
  const seen = new Set<string>();

  for (const connection of connections ?? []) {
    if (connection.kind !== "APToDB") {
      continue;
    }
    if (
      ref.kind === "AP" &&
      connection.source.kind === "AP" &&
      canvasResourceKey(connection.source) === canvasResourceKey(ref)
    ) {
      const anchor = connection.target as CanvasLayoutResourceRef;
      const key = canvasResourceKey(anchor);
      if (!seen.has(key)) {
        seen.add(key);
        anchors.push({ direction: "left", ref: anchor });
      }
    }
    if (
      ref.kind === "DB" &&
      connection.target.kind === "DB" &&
      canvasResourceKey(connection.target) === canvasResourceKey(ref)
    ) {
      const anchor = connection.source as CanvasLayoutResourceRef;
      const key = canvasResourceKey(anchor);
      if (!seen.has(key)) {
        seen.add(key);
        anchors.push({ direction: "right", ref: anchor });
      }
    }
  }

  return anchors.sort((a, b) =>
    canvasResourceKey(a.ref).localeCompare(canvasResourceKey(b.ref))
  );
}

function anchorOffsets(direction: PlacementDirection): CanvasLayoutPosition[] {
  return direction === "left" ? leftAnchorOffsets() : rightAnchorOffsets();
}

function anchoredPosition(
  anchor: PlacementAnchor,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  allocated: readonly CanvasNodeRect[],
  height: number
): CanvasLayoutPosition | undefined {
  const anchorPosition = positionByRef.get(canvasResourceKey(anchor.ref));
  if (anchorPosition === undefined) {
    return undefined;
  }
  return firstOpenPosition(
    anchorOffsets(anchor.direction).map((offset) =>
      positionForAnchorCandidate(anchorPosition, offset)
    ),
    allocated,
    height
  );
}

function firstAnchoredPosition(
  anchors: readonly PlacementAnchor[],
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  allocated: readonly CanvasNodeRect[],
  height: number
): CanvasLayoutPosition | undefined {
  for (const anchor of anchors) {
    const position = anchoredPosition(anchor, positionByRef, allocated, height);
    if (position !== undefined) {
      return position;
    }
  }
  return undefined;
}

function entryPointAnchorPosition(
  candidate: PlacementCandidate,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  allocated: readonly CanvasNodeRect[]
): CanvasLayoutPosition | undefined {
  const apRef = canvasEntryPointApResourceIdentityFromNode(candidate.node);
  const apPosition =
    apRef === undefined
      ? undefined
      : positionByRef.get(canvasResourceKey(apRef));
  if (apPosition === undefined) {
    return undefined;
  }
  return firstOpenPosition(
    entryPointAnchorOffsets().map((offset) =>
      positionForAnchorCandidate(apPosition, offset)
    ),
    allocated,
    nodeFootprintHeight(candidate.node)
  );
}

function savedPositionByRef(
  layout: CanvasLayoutDocument | undefined
): Map<string, CanvasLayoutPosition> {
  return new Map(
    (layout?.nodes ?? []).map((node) => [
      canvasResourceKey(node.ref),
      node.position,
    ])
  );
}

export function placeCanvasNodesWithLayout({
  connections,
  layout,
  nodes,
}: PlaceCanvasNodesOptions): PlaceCanvasNodesResult {
  const savedByRef = savedPositionByRef(layout);
  const positionByRef = new Map(savedByRef);
  const allocated = (layout?.nodes ?? []).map((node) =>
    rectFromPosition(node.position, layoutNodeFootprintHeight(node))
  );
  const globalOrigins = globalBlockOrigins(allocated);
  const placedNodes = nodes.map((node) => ({ ...node }));
  const placedLayoutNodes: CanvasLayoutNode[] = [];
  const rasterCandidates: PlacementCandidate[] = [];
  const entryPointCandidates: PlacementCandidate[] = [];

  placedNodes.forEach((node, index) => {
    const ref = canvasResourceIdentityFromNode(node);
    const key = ref === undefined ? undefined : canvasResourceKey(ref);
    const savedPosition = key === undefined ? undefined : savedByRef.get(key);
    if (savedPosition !== undefined) {
      placedNodes[index] = nodeWithPosition(node, savedPosition);
      return;
    }

    const candidate = {
      index,
      node,
      ref,
      sortKey: key ?? `Unknown:${index}:${node.id}`,
    };
    if (ref?.kind === "EntryPoint") {
      entryPointCandidates.push(candidate);
    } else {
      rasterCandidates.push(candidate);
    }
  });

  for (const candidate of [...rasterCandidates].sort(
    comparePlacementCandidates
  )) {
    const height = nodeFootprintHeight(candidate.node);
    const position =
      candidate.ref === undefined
        ? undefined
        : firstAnchoredPosition(
            connectionAnchorsForRef(candidate.ref, connections),
            positionByRef,
            allocated,
            height
          );
    const placement =
      position ?? firstOpenGlobalPosition(globalOrigins, allocated, height);
    allocated.push(rectFromPosition(placement, height));
    placedNodes[candidate.index] = nodeWithGeneratedPosition(
      candidate.node,
      placement
    );
    if (candidate.ref !== undefined) {
      positionByRef.set(canvasResourceKey(candidate.ref), placement);
      placedLayoutNodes.push(
        layoutNodeFromPlacedNode(candidate.node, candidate.ref, placement)
      );
    }
  }

  for (const candidate of [...entryPointCandidates].sort(
    comparePlacementCandidates
  )) {
    const height = nodeFootprintHeight(candidate.node);
    const position =
      entryPointAnchorPosition(candidate, positionByRef, allocated) ??
      firstOpenGlobalPosition(globalOrigins, allocated, height);

    allocated.push(rectFromPosition(position, height));
    placedNodes[candidate.index] = nodeWithGeneratedPosition(
      candidate.node,
      position
    );
    if (candidate.ref !== undefined) {
      positionByRef.set(canvasResourceKey(candidate.ref), position);
      placedLayoutNodes.push(
        layoutNodeFromPlacedNode(candidate.node, candidate.ref, position)
      );
    }
  }

  return { nodes: placedNodes, placedLayoutNodes };
}

export function placeCanvasNodes(options: PlaceCanvasNodesOptions): Node[] {
  return placeCanvasNodesWithLayout(options).nodes;
}
