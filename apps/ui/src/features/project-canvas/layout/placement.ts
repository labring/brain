import type { Node } from "@xyflow/react";

import type { CanvasDetectedConnection } from "../flow/detected-connections";
import {
  canvasEntryPointApResourceIdentityFromNode,
  canvasResourceIdentityFromNode,
  canvasResourceKey,
  canvasResourceLastSeenUidFromNode,
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
const GLOBAL_CANVAS_TARGET_RATIO = 2;
const GLOBAL_SHAPE_SOFT_TOLERANCE = 0.2;
const GLOBAL_EXTRA_COLUMNS = 4;
const GLOBAL_ROW_SEARCH_LIMIT = 24;
const CANVAS_NODE_FOOTPRINT_WIDTH = CANVAS_NODE_FALLBACK_WIDTH;
const CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED = CANVAS_NODE_FALLBACK_HEIGHT;
const CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED = 220;
const COLUMN_STEP = 340;
const ROW_STEP = 280;
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

interface CanvasRectBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

interface PlacementCandidate {
  index: number;
  node: Node;
  ref: CanvasLayoutResourceRef | undefined;
  sortKey: string;
}

interface PlacementFootprint {
  rects: CanvasNodeRect[];
}

interface GlobalCandidateRows {
  currentRow: CanvasLayoutPosition[];
  futureRows: CanvasLayoutPosition[];
}

interface PlacementGroupCandidate {
  ap: PlacementCandidate & { ref: CanvasLayoutResourceRef };
  entryPoint: PlacementCandidate & { ref: CanvasLayoutResourceRef };
  footprint: PlacementFootprint;
  sortKey: string;
}

type PlacementUnit =
  | { candidate: PlacementCandidate; kind: "single" }
  | { group: PlacementGroupCandidate; kind: "group" };

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

function singleNodeFootprint(height: number): PlacementFootprint {
  return { rects: [rectFromPosition({ x: 0, y: 0 }, height)] };
}

function apEntryPointFootprint(
  apHeight: number,
  entryPointHeight: number
): PlacementFootprint {
  return {
    rects: [
      {
        height: Math.max(apHeight, entryPointHeight),
        width: ENTRY_POINT_AP_LEFT_OFFSET + CANVAS_NODE_FOOTPRINT_WIDTH,
        x: 0,
        y: 0,
      },
    ],
  };
}

function rectBounds(rects: readonly CanvasNodeRect[]): CanvasRectBounds {
  return {
    maxX: Math.max(...rects.map((rect) => rect.x + rect.width)),
    maxY: Math.max(...rects.map((rect) => rect.y + rect.height)),
    minX: Math.min(...rects.map((rect) => rect.x)),
    minY: Math.min(...rects.map((rect) => rect.y)),
  };
}

function footprintBounds(footprint: PlacementFootprint): CanvasRectBounds {
  return rectBounds(footprint.rects);
}

function rectsFromFootprintPosition(
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

function rectsIntersect(a: CanvasNodeRect, b: CanvasNodeRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function rectsAreOpen(
  rects: readonly CanvasNodeRect[],
  allocated: readonly CanvasNodeRect[]
): boolean {
  return rects.every(
    (candidate) => !allocated.some((rect) => rectsIntersect(candidate, rect))
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

function hasGeneratedPosition(
  node: Node,
  position: CanvasLayoutPosition
): boolean {
  const layout = asRecord(asRecord(node.data)?.layout);
  const generatedPosition = asRecord(layout?.generatedPosition);
  return (
    layout?.positionSource === GENERATED_POSITION_SOURCE &&
    generatedPosition?.x === position.x &&
    generatedPosition?.y === position.y
  );
}

function comparePlacementUnits(a: PlacementUnit, b: PlacementUnit): number {
  const aKey = a.kind === "group" ? a.group.sortKey : a.candidate.sortKey;
  const bKey = b.kind === "group" ? b.group.sortKey : b.candidate.sortKey;
  return aKey.localeCompare(bKey);
}

function nodeWithPosition(node: Node, position: CanvasLayoutPosition): Node {
  if (node.position.x === position.x && node.position.y === position.y) {
    return node;
  }
  return {
    ...node,
    position: { x: position.x, y: position.y },
  };
}

function nodeWithGeneratedPosition(
  node: Node,
  position: CanvasLayoutPosition
): Node {
  if (
    node.position.x === position.x &&
    node.position.y === position.y &&
    hasGeneratedPosition(node, position)
  ) {
    return node;
  }

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
  const lastSeenUid = canvasResourceLastSeenUidFromNode(node);
  return {
    expanded,
    ...(lastSeenUid === undefined ? {} : { lastSeenUid }),
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

function paddedCanvasHeight(bounds: CanvasRectBounds): number {
  return Math.max(
    ROW_STEP,
    Math.ceil((bounds.maxY - bounds.minY) / ROW_STEP) * ROW_STEP
  );
}

function canvasShapePenalty(rects: readonly CanvasNodeRect[]): number {
  const bounds = rectBounds(rects);
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
  allocated: readonly CanvasNodeRect[],
  footprint: PlacementFootprint
): GlobalCandidateRows {
  if (allocated.length === 0) {
    return { currentRow: [{ x: 0, y: 0 }], futureRows: [] };
  }

  const bounds = rectBounds(allocated);
  const maxRow = Math.max(
    ...allocated.map((rect) => candidateRowIndex(rect, bounds.minY))
  );
  const lastRowRects = allocated.filter(
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

function firstOpenFootprintPosition(
  candidates: readonly CanvasLayoutPosition[],
  allocated: readonly CanvasNodeRect[],
  footprint: PlacementFootprint
): CanvasLayoutPosition | undefined {
  return candidates.find((position) =>
    rectsAreOpen(rectsFromFootprintPosition(footprint, position), allocated)
  );
}

function globalCandidatePenalty(
  allocated: readonly CanvasNodeRect[],
  footprint: PlacementFootprint,
  position: CanvasLayoutPosition
): number {
  return canvasShapePenalty([
    ...allocated,
    ...rectsFromFootprintPosition(footprint, position),
  ]);
}

function firstOpenGlobalPosition(
  allocated: readonly CanvasNodeRect[],
  footprint: PlacementFootprint
): CanvasLayoutPosition {
  const candidates = globalCandidateRows(allocated, footprint);
  const currentRow = firstOpenFootprintPosition(
    candidates.currentRow,
    allocated,
    footprint
  );
  const futureRow = firstOpenFootprintPosition(
    candidates.futureRows,
    allocated,
    footprint
  );

  if (currentRow !== undefined && futureRow !== undefined) {
    const currentPenalty = globalCandidatePenalty(
      allocated,
      footprint,
      currentRow
    );
    const futurePenalty = globalCandidatePenalty(
      allocated,
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
    const rects = rectsFromFootprintPosition(footprint, position);
    if (rectsAreOpen(rects, allocated)) {
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
  footprint: PlacementFootprint
): CanvasLayoutPosition | undefined {
  const anchorPosition = positionByRef.get(canvasResourceKey(anchor.ref));
  if (anchorPosition === undefined) {
    return undefined;
  }
  return anchorOffsets(anchor.direction)
    .map((offset) => positionForAnchorCandidate(anchorPosition, offset))
    .find((position) =>
      rectsAreOpen(rectsFromFootprintPosition(footprint, position), allocated)
    );
}

function firstAnchoredPosition(
  anchors: readonly PlacementAnchor[],
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  allocated: readonly CanvasNodeRect[],
  footprint: PlacementFootprint
): CanvasLayoutPosition | undefined {
  for (const anchor of anchors) {
    const position = anchoredPosition(
      anchor,
      positionByRef,
      allocated,
      footprint
    );
    if (position !== undefined) {
      return position;
    }
  }
  return undefined;
}

function anchoredGroupPosition(
  anchor: PlacementAnchor,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  allocated: readonly CanvasNodeRect[],
  footprint: PlacementFootprint
): CanvasLayoutPosition | undefined {
  const anchorPosition = positionByRef.get(canvasResourceKey(anchor.ref));
  if (anchorPosition === undefined) {
    return undefined;
  }
  return anchorOffsets(anchor.direction)
    .map((offset) => positionForAnchorCandidate(anchorPosition, offset))
    .map((apPosition) => ({
      x: apPosition.x - ENTRY_POINT_AP_LEFT_OFFSET,
      y: apPosition.y,
    }))
    .find((position) =>
      rectsAreOpen(rectsFromFootprintPosition(footprint, position), allocated)
    );
}

function firstAnchoredGroupPosition(
  group: PlacementGroupCandidate,
  anchors: readonly PlacementAnchor[],
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  allocated: readonly CanvasNodeRect[]
): CanvasLayoutPosition | undefined {
  for (const anchor of anchors) {
    const position = anchoredGroupPosition(
      anchor,
      positionByRef,
      allocated,
      group.footprint
    );
    if (position !== undefined) {
      return position;
    }
  }
  return undefined;
}

function singleCandidateFootprint(candidate: PlacementCandidate) {
  return singleNodeFootprint(nodeFootprintHeight(candidate.node));
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

function isReferencedPlacementCandidate(
  candidate: PlacementCandidate
): candidate is PlacementCandidate & { ref: CanvasLayoutResourceRef } {
  return candidate.ref !== undefined;
}

function apEntryPointPositionFromGroupOrigin(origin: CanvasLayoutPosition): {
  ap: CanvasLayoutPosition;
  entryPoint: CanvasLayoutPosition;
} {
  return {
    ap: { x: origin.x + ENTRY_POINT_AP_LEFT_OFFSET, y: origin.y },
    entryPoint: { x: origin.x, y: origin.y },
  };
}

function placementUnitFootprint(unit: PlacementUnit): PlacementFootprint {
  if (unit.kind === "group") {
    return unit.group.footprint;
  }
  return singleCandidateFootprint(unit.candidate);
}

function buildPlacementUnits(
  candidates: readonly PlacementCandidate[]
): PlacementUnit[] {
  const apCandidatesByKey = new Map<
    string,
    PlacementCandidate & { ref: CanvasLayoutResourceRef }
  >();
  const entryPointCandidatesByApKey = new Map<
    string,
    PlacementCandidate & { ref: CanvasLayoutResourceRef }
  >();
  for (const candidate of candidates) {
    if (!isReferencedPlacementCandidate(candidate)) {
      continue;
    }
    if (candidate.ref.kind === "AP") {
      apCandidatesByKey.set(canvasResourceKey(candidate.ref), candidate);
    }
    if (candidate.ref.kind === "EntryPoint") {
      entryPointCandidatesByApKey.set(
        canvasResourceKey({
          kind: "AP",
          name: candidate.ref.name,
          namespace: candidate.ref.namespace,
        }),
        candidate
      );
    }
  }

  const groupedIndexes = new Set<number>();
  const units: PlacementUnit[] = [];
  for (const [apKey, ap] of apCandidatesByKey) {
    const entryPoint = entryPointCandidatesByApKey.get(apKey);
    if (entryPoint === undefined) {
      continue;
    }
    groupedIndexes.add(ap.index);
    groupedIndexes.add(entryPoint.index);
    units.push({
      group: {
        ap,
        entryPoint,
        footprint: apEntryPointFootprint(
          nodeFootprintHeight(ap.node),
          nodeFootprintHeight(entryPoint.node)
        ),
        sortKey: ap.sortKey,
      },
      kind: "group",
    });
  }

  for (const candidate of candidates) {
    if (groupedIndexes.has(candidate.index)) {
      continue;
    }
    units.push({ candidate, kind: "single" });
  }

  return units.sort(comparePlacementUnits);
}

function placeCandidateAt(
  candidate: PlacementCandidate,
  position: CanvasLayoutPosition,
  positionByRef: Map<string, CanvasLayoutPosition>,
  placedNodes: Node[],
  placedLayoutNodes: CanvasLayoutNode[]
): void {
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

function placeUnitAt(
  unit: PlacementUnit,
  origin: CanvasLayoutPosition,
  positionByRef: Map<string, CanvasLayoutPosition>,
  placedNodes: Node[],
  placedLayoutNodes: CanvasLayoutNode[]
): void {
  if (unit.kind === "single") {
    placeCandidateAt(
      unit.candidate,
      origin,
      positionByRef,
      placedNodes,
      placedLayoutNodes
    );
    return;
  }

  const positions = apEntryPointPositionFromGroupOrigin(origin);
  placeCandidateAt(
    unit.group.ap,
    positions.ap,
    positionByRef,
    placedNodes,
    placedLayoutNodes
  );
  placeCandidateAt(
    unit.group.entryPoint,
    positions.entryPoint,
    positionByRef,
    placedNodes,
    placedLayoutNodes
  );
}

function placementForUnit(
  unit: PlacementUnit,
  connections: readonly CanvasDetectedConnection[] | undefined,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  allocated: readonly CanvasNodeRect[]
): CanvasLayoutPosition {
  const footprint = placementUnitFootprint(unit);

  if (unit.kind === "group") {
    const position = firstAnchoredGroupPosition(
      unit.group,
      connectionAnchorsForRef(unit.group.ap.ref, connections),
      positionByRef,
      allocated
    );
    return position ?? firstOpenGlobalPosition(allocated, footprint);
  }

  const candidate = unit.candidate;
  const entryPointPosition =
    candidate.ref?.kind === "EntryPoint"
      ? entryPointAnchorPosition(candidate, positionByRef, allocated)
      : undefined;
  const anchored =
    candidate.ref === undefined
      ? undefined
      : firstAnchoredPosition(
          connectionAnchorsForRef(candidate.ref, connections),
          positionByRef,
          allocated,
          footprint
        );
  return (
    entryPointPosition ??
    anchored ??
    firstOpenGlobalPosition(allocated, footprint)
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
  const placedNodes = [...nodes];
  const placedLayoutNodes: CanvasLayoutNode[] = [];
  const placementCandidates: PlacementCandidate[] = [];

  placedNodes.forEach((node, index) => {
    const ref = canvasResourceIdentityFromNode(node);
    const key = ref === undefined ? undefined : canvasResourceKey(ref);
    const savedPosition = key === undefined ? undefined : savedByRef.get(key);
    if (savedPosition !== undefined) {
      placedNodes[index] = nodeWithPosition(node, savedPosition);
      return;
    }

    placementCandidates.push({
      index,
      node,
      ref,
      sortKey: key ?? `Unknown:${index}:${node.id}`,
    });
  });

  for (const unit of buildPlacementUnits(placementCandidates)) {
    const footprint = placementUnitFootprint(unit);
    const placement = placementForUnit(
      unit,
      connections,
      positionByRef,
      allocated
    );
    allocated.push(...rectsFromFootprintPosition(footprint, placement));
    placeUnitAt(unit, placement, positionByRef, placedNodes, placedLayoutNodes);
  }

  const resolvedNodes = placedNodes.every(
    (node, index) => node === nodes[index]
  )
    ? nodes
    : placedNodes;
  return { nodes: resolvedNodes, placedLayoutNodes };
}

export function placeCanvasNodes(options: PlaceCanvasNodesOptions): Node[] {
  return placeCanvasNodesWithLayout(options).nodes;
}
