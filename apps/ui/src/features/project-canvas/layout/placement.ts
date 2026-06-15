import type { Node } from "@xyflow/react";

import type { CanvasDetectedConnection } from "../flow/detected-connections";
import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import {
  canvasPublicAccessApResourceIdentityFromNode,
  canvasResourceIdentityFromNode,
  canvasResourceKey,
  canvasResourceLastSeenUidFromNode,
} from "../nodes/resource-identity";
import {
  createPlacementAnchorIndex,
  type PlacementAnchor,
  type PlacementAnchorIndex,
  type PlacementDirection,
} from "./placement-anchors";
import {
  apPublicAccessFootprint,
  CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED,
  CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED,
  CANVAS_NODE_FOOTPRINT_WIDTH,
  type CanvasNodeRect,
  type CanvasRectBounds,
  COLUMN_STEP,
  footprintBounds,
  type PlacementFootprint,
  PUBLIC_ACCESS_AP_LEFT_OFFSET,
  ROW_STEP,
  rectFromPosition,
  rectsFromFootprintPosition,
  singleNodeFootprint,
} from "./placement-geometry";
import { PlacementOccupancy } from "./placement-occupancy";
import {
  canvasLayoutNodeKey,
  canvasLayoutNodeResourceRef,
  canvasPlacementOwnerFromNode,
  canvasPlacementOwnerKey,
} from "./placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasLayoutResourceRef,
  CanvasPlacementOwner,
} from "./types";

const GLOBAL_BLOCK_COLUMNS = 3;
const GLOBAL_CANVAS_TARGET_RATIO = 2;
const GLOBAL_SHAPE_SOFT_TOLERANCE = 0.2;
const GLOBAL_EXTRA_COLUMNS = 4;
const GLOBAL_ROW_SEARCH_LIMIT = 24;
const GENERATED_POSITION_SOURCE = "generated";

export interface PlaceCanvasNodesOptions {
  connections?: readonly CanvasDetectedConnection[];
  initialPositionByNodeId?: ReadonlyMap<string, CanvasLayoutPosition>;
  initialPositionByRef?: ReadonlyMap<string, CanvasLayoutPosition>;
  layout: CanvasLayoutDocument | undefined;
  nodes: Node[];
  retainedLayoutOwnerKeys?: ReadonlySet<string>;
}

export interface PlaceCanvasNodesResult {
  nodes: Node[];
  placedLayoutNodes: CanvasLayoutNode[];
}

interface PlacementCandidate {
  index: number;
  node: Node;
  owner: CanvasPlacementOwner | undefined;
  ref: CanvasLayoutResourceRef | undefined;
  sortKey: string;
}

interface GlobalCandidateRows {
  currentRow: CanvasLayoutPosition[];
  futureRows: CanvasLayoutPosition[];
}

interface PlacementGroupCandidate {
  ap: PlacementCandidate & { ref: CanvasLayoutResourceRef };
  footprint: PlacementFootprint;
  publicAccess: PlacementCandidate & { ref: CanvasLayoutResourceRef };
  sortKey: string;
}

interface DeploymentPreviewGroupCandidate {
  candidates: PlacementCandidate[];
  footprint: PlacementFootprint;
  relativePositions: Map<number, CanvasLayoutPosition>;
  sortKey: string;
}

type PlacementUnit =
  | { candidate: PlacementCandidate; kind: "single" }
  | { group: PlacementGroupCandidate; kind: "group" }
  | { group: DeploymentPreviewGroupCandidate; kind: "deploymentPreviewGroup" };

function fallbackCanvasPosition(index: number): CanvasLayoutPosition {
  return {
    x: (index % GLOBAL_BLOCK_COLUMNS) * COLUMN_STEP,
    y: Math.floor(index / GLOBAL_BLOCK_COLUMNS) * ROW_STEP,
  };
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

function hasFinitePosition(node: Node): boolean {
  return Number.isFinite(node.position.x) && Number.isFinite(node.position.y);
}

function isPlacedDeploymentPlaceholderNode(node: Node): boolean {
  const data = asRecord(node.data);
  return (
    node.type === CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE &&
    data?.hasProjectionPlacement === true &&
    hasFinitePosition(node)
  );
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
  const aKey = a.kind === "single" ? a.candidate.sortKey : a.group.sortKey;
  const bKey = b.kind === "single" ? b.candidate.sortKey : b.group.sortKey;
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
  owner: CanvasPlacementOwner,
  position: CanvasLayoutPosition
): CanvasLayoutNode {
  if (owner.kind === "deploymentProjection") {
    return {
      owner,
      position: { x: position.x, y: position.y },
      source: GENERATED_POSITION_SOURCE,
    };
  }
  const data = asRecord(node.data);
  const layout = asRecord(data?.layout);
  const expanded =
    typeof layout?.expanded === "boolean" ? layout.expanded : false;
  const lastSeenUid = canvasResourceLastSeenUidFromNode(node);
  return {
    expanded,
    ...(lastSeenUid === undefined ? {} : { lastSeenUid }),
    owner,
    position: { x: position.x, y: position.y },
    source: GENERATED_POSITION_SOURCE,
  };
}

function positionForAnchorCandidate(
  anchor: CanvasLayoutPosition,
  offset: CanvasLayoutPosition
): CanvasLayoutPosition {
  return { x: anchor.x + offset.x, y: anchor.y + offset.y };
}

function publicAccessAnchorOffsets(): CanvasLayoutPosition[] {
  return [
    { x: -PUBLIC_ACCESS_AP_LEFT_OFFSET, y: 0 },
    { x: -PUBLIC_ACCESS_AP_LEFT_OFFSET, y: -ROW_STEP },
    { x: -PUBLIC_ACCESS_AP_LEFT_OFFSET, y: ROW_STEP },
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

function firstOpenGlobalPosition(
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

function anchorOffsets(direction: PlacementDirection): CanvasLayoutPosition[] {
  return direction === "left" ? leftAnchorOffsets() : rightAnchorOffsets();
}

function anchoredPosition(
  anchor: PlacementAnchor,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy,
  footprint: PlacementFootprint
): CanvasLayoutPosition | undefined {
  const anchorPosition = positionByRef.get(canvasResourceKey(anchor.ref));
  if (anchorPosition === undefined) {
    return undefined;
  }
  return anchorOffsets(anchor.direction)
    .map((offset) => positionForAnchorCandidate(anchorPosition, offset))
    .find((position) => occupancy.isFootprintOpen(footprint, position));
}

function firstAnchoredPosition(
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

function anchoredGroupPosition(
  anchor: PlacementAnchor,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy,
  footprint: PlacementFootprint
): CanvasLayoutPosition | undefined {
  const anchorPosition = positionByRef.get(canvasResourceKey(anchor.ref));
  if (anchorPosition === undefined) {
    return undefined;
  }
  return anchorOffsets(anchor.direction)
    .map((offset) => positionForAnchorCandidate(anchorPosition, offset))
    .map((apPosition) => ({
      x: apPosition.x - PUBLIC_ACCESS_AP_LEFT_OFFSET,
      y: apPosition.y,
    }))
    .find((position) => occupancy.isFootprintOpen(footprint, position));
}

function firstAnchoredGroupPosition(
  group: PlacementGroupCandidate,
  anchors: readonly PlacementAnchor[],
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy
): CanvasLayoutPosition | undefined {
  for (const anchor of anchors) {
    const position = anchoredGroupPosition(
      anchor,
      positionByRef,
      occupancy,
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

function publicAccessAnchorPosition(
  candidate: PlacementCandidate,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy
): CanvasLayoutPosition | undefined {
  const apRef = canvasPublicAccessApResourceIdentityFromNode(candidate.node);
  const apPosition =
    apRef === undefined
      ? undefined
      : positionByRef.get(canvasResourceKey(apRef));
  if (apPosition === undefined) {
    return undefined;
  }
  return occupancy.firstOpenPosition(
    publicAccessAnchorOffsets().map((offset) =>
      positionForAnchorCandidate(apPosition, offset)
    ),
    nodeFootprintHeight(candidate.node)
  );
}

function isReferencedPlacementCandidate(
  candidate: PlacementCandidate
): candidate is PlacementCandidate & { ref: CanvasLayoutResourceRef } {
  return candidate.ref !== undefined;
}

function apPublicAccessPositionFromGroupOrigin(origin: CanvasLayoutPosition): {
  ap: CanvasLayoutPosition;
  publicAccess: CanvasLayoutPosition;
} {
  return {
    ap: { x: origin.x + PUBLIC_ACCESS_AP_LEFT_OFFSET, y: origin.y },
    publicAccess: { x: origin.x, y: origin.y },
  };
}

function placementUnitFootprint(unit: PlacementUnit): PlacementFootprint {
  if (unit.kind !== "single") {
    return unit.group.footprint;
  }
  return singleCandidateFootprint(unit.candidate);
}

function deploymentPreviewGroupInfo(
  candidate: PlacementCandidate
): { groupId: string; relativePosition: CanvasLayoutPosition } | undefined {
  const data = asRecord(candidate.node.data);
  const relative = asRecord(data?.projectionRelativePlacement);
  const groupId = data?.groupId;
  const relativeX = relative?.x;
  const relativeY = relative?.y;
  if (
    !Array.isArray(data?.projectionSlots) ||
    typeof groupId !== "string" ||
    !Number.isFinite(relativeX) ||
    !Number.isFinite(relativeY)
  ) {
    return undefined;
  }
  return {
    groupId,
    relativePosition: { x: relativeX as number, y: relativeY as number },
  };
}

function deploymentPreviewFootprint(
  candidates: readonly PlacementCandidate[],
  relativePositions: ReadonlyMap<number, CanvasLayoutPosition>
): PlacementFootprint {
  return {
    rects: candidates.map((candidate) => ({
      height: nodeFootprintHeight(candidate.node),
      width: CANVAS_NODE_FOOTPRINT_WIDTH,
      x: relativePositions.get(candidate.index)?.x ?? 0,
      y: relativePositions.get(candidate.index)?.y ?? 0,
    })),
  };
}

function deploymentPreviewGroupUnits(
  candidates: readonly PlacementCandidate[]
): { groupedIndexes: Set<number>; units: PlacementUnit[] } {
  const candidatesByGroup = new Map<string, PlacementCandidate[]>();
  const relativePositionsByGroup = new Map<
    string,
    Map<number, CanvasLayoutPosition>
  >();
  for (const candidate of candidates) {
    const previewGroup = deploymentPreviewGroupInfo(candidate);
    if (previewGroup === undefined) {
      continue;
    }
    const group = candidatesByGroup.get(previewGroup.groupId) ?? [];
    group.push(candidate);
    candidatesByGroup.set(previewGroup.groupId, group);
    const relativePositions =
      relativePositionsByGroup.get(previewGroup.groupId) ??
      new Map<number, CanvasLayoutPosition>();
    relativePositions.set(candidate.index, previewGroup.relativePosition);
    relativePositionsByGroup.set(previewGroup.groupId, relativePositions);
  }

  const groupedIndexes = new Set<number>();
  const units: PlacementUnit[] = [];
  for (const [groupId, groupCandidates] of candidatesByGroup) {
    const relativePositions =
      relativePositionsByGroup.get(groupId) ??
      new Map<number, CanvasLayoutPosition>();
    for (const candidate of groupCandidates) {
      groupedIndexes.add(candidate.index);
    }
    units.push({
      group: {
        candidates: groupCandidates,
        footprint: deploymentPreviewFootprint(
          groupCandidates,
          relativePositions
        ),
        relativePositions,
        sortKey: `DeploymentPreview:${groupId}`,
      },
      kind: "deploymentPreviewGroup",
    });
  }
  return { groupedIndexes, units };
}

function apPublicAccessGroupUnits(
  candidates: readonly PlacementCandidate[],
  groupedIndexes: Set<number>
): PlacementUnit[] {
  const apCandidatesByKey = new Map<
    string,
    PlacementCandidate & { ref: CanvasLayoutResourceRef }
  >();
  const publicAccessCandidatesByApKey = new Map<
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
    if (candidate.ref.kind === "PublicAccess") {
      publicAccessCandidatesByApKey.set(
        canvasResourceKey({
          kind: "AP",
          name: candidate.ref.name,
          namespace: candidate.ref.namespace,
        }),
        candidate
      );
    }
  }

  const units: PlacementUnit[] = [];
  for (const [apKey, ap] of apCandidatesByKey) {
    const publicAccess = publicAccessCandidatesByApKey.get(apKey);
    if (publicAccess === undefined) {
      continue;
    }
    groupedIndexes.add(ap.index);
    groupedIndexes.add(publicAccess.index);
    units.push({
      group: {
        ap,
        publicAccess,
        footprint: apPublicAccessFootprint(
          nodeFootprintHeight(ap.node),
          nodeFootprintHeight(publicAccess.node)
        ),
        sortKey: ap.sortKey,
      },
      kind: "group",
    });
  }
  return units;
}

function buildPlacementUnits(
  candidates: readonly PlacementCandidate[]
): PlacementUnit[] {
  const previewGroups = deploymentPreviewGroupUnits(candidates);
  const groupedIndexes = previewGroups.groupedIndexes;
  const units: PlacementUnit[] = [
    ...previewGroups.units,
    ...apPublicAccessGroupUnits(candidates, groupedIndexes),
  ];
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
  if (candidate.owner !== undefined) {
    if (candidate.ref !== undefined) {
      positionByRef.set(canvasResourceKey(candidate.ref), position);
    }
    placedLayoutNodes.push(
      layoutNodeFromPlacedNode(candidate.node, candidate.owner, position)
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

  if (unit.kind === "deploymentPreviewGroup") {
    for (const candidate of unit.group.candidates) {
      const relative = unit.group.relativePositions.get(candidate.index) ?? {
        x: 0,
        y: 0,
      };
      placeCandidateAt(
        candidate,
        { x: origin.x + relative.x, y: origin.y + relative.y },
        positionByRef,
        placedNodes,
        placedLayoutNodes
      );
    }
    return;
  }

  const positions = apPublicAccessPositionFromGroupOrigin(origin);
  placeCandidateAt(
    unit.group.ap,
    positions.ap,
    positionByRef,
    placedNodes,
    placedLayoutNodes
  );
  placeCandidateAt(
    unit.group.publicAccess,
    positions.publicAccess,
    positionByRef,
    placedNodes,
    placedLayoutNodes
  );
}

function placementForSingleUnit(
  candidate: PlacementCandidate,
  anchorIndex: PlacementAnchorIndex,
  initialPositionByNodeId:
    | ReadonlyMap<string, CanvasLayoutPosition>
    | undefined,
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy
): CanvasLayoutPosition {
  const footprint = singleCandidateFootprint(candidate);
  const initialPosition =
    candidate.ref === undefined
      ? initialPositionByNodeId?.get(candidate.node.id)
      : initialPositionByRef?.get(canvasResourceKey(candidate.ref));
  if (
    initialPosition !== undefined &&
    occupancy.isFootprintOpen(footprint, initialPosition)
  ) {
    return initialPosition;
  }

  const publicAccessPosition =
    candidate.ref?.kind === "PublicAccess"
      ? publicAccessAnchorPosition(candidate, positionByRef, occupancy)
      : undefined;
  const anchored =
    candidate.ref === undefined
      ? undefined
      : firstAnchoredPosition(
          anchorIndex.anchorsForRef(candidate.ref),
          positionByRef,
          occupancy,
          footprint
        );
  return (
    publicAccessPosition ??
    anchored ??
    firstOpenGlobalPosition(occupancy, footprint)
  );
}

function placementForDeploymentPreviewGroup(
  group: DeploymentPreviewGroupCandidate,
  occupancy: PlacementOccupancy
): CanvasLayoutPosition {
  const firstCandidate = group.candidates[0];
  const relative =
    firstCandidate === undefined
      ? undefined
      : group.relativePositions.get(firstCandidate.index);
  const initialOrigin =
    firstCandidate === undefined || relative === undefined
      ? undefined
      : {
          x: firstCandidate.node.position.x - relative.x,
          y: firstCandidate.node.position.y - relative.y,
        };
  if (
    initialOrigin !== undefined &&
    occupancy.isFootprintOpen(group.footprint, initialOrigin)
  ) {
    return initialOrigin;
  }
  return firstOpenGlobalPosition(occupancy, group.footprint);
}

function placementForApPublicAccessGroup(
  group: PlacementGroupCandidate,
  anchorIndex: PlacementAnchorIndex,
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy
): CanvasLayoutPosition {
  const apInitialPosition = initialPositionByRef?.get(
    canvasResourceKey(group.ap.ref)
  );
  const initialGroupOrigin =
    apInitialPosition === undefined
      ? undefined
      : {
          x: apInitialPosition.x - PUBLIC_ACCESS_AP_LEFT_OFFSET,
          y: apInitialPosition.y,
        };
  if (
    initialGroupOrigin !== undefined &&
    occupancy.isFootprintOpen(group.footprint, initialGroupOrigin)
  ) {
    return initialGroupOrigin;
  }
  const position = firstAnchoredGroupPosition(
    group,
    anchorIndex.anchorsForRef(group.ap.ref),
    positionByRef,
    occupancy
  );
  return position ?? firstOpenGlobalPosition(occupancy, group.footprint);
}

function placementForUnit(
  unit: PlacementUnit,
  anchorIndex: PlacementAnchorIndex,
  initialPositionByNodeId:
    | ReadonlyMap<string, CanvasLayoutPosition>
    | undefined,
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy
): CanvasLayoutPosition {
  if (unit.kind === "single") {
    return placementForSingleUnit(
      unit.candidate,
      anchorIndex,
      initialPositionByNodeId,
      initialPositionByRef,
      positionByRef,
      occupancy
    );
  }

  if (unit.kind === "deploymentPreviewGroup") {
    return placementForDeploymentPreviewGroup(unit.group, occupancy);
  }

  return placementForApPublicAccessGroup(
    unit.group,
    anchorIndex,
    initialPositionByRef,
    positionByRef,
    occupancy
  );
}

function savedPositionByRef(
  layout: CanvasLayoutDocument | undefined
): Map<string, CanvasLayoutPosition> {
  return new Map(
    (layout?.nodes ?? []).flatMap((node) => {
      const ref = canvasLayoutNodeResourceRef(node);
      return ref === undefined
        ? []
        : [[canvasResourceKey(ref), node.position] as const];
    })
  );
}

function savedPositionByOwner(
  layout: CanvasLayoutDocument | undefined
): Map<string, CanvasLayoutPosition> {
  return new Map(
    (layout?.nodes ?? []).map((node) => [
      canvasLayoutNodeKey(node),
      node.position,
    ])
  );
}

function occupancyLayoutNodes(input: {
  layout: CanvasLayoutDocument | undefined;
  nodes: readonly Node[];
  retainedLayoutOwnerKeys?: ReadonlySet<string>;
}): CanvasLayoutNode[] {
  const renderedOwnerKeys = new Set(
    input.nodes.flatMap((node) => {
      const owner = canvasPlacementOwnerFromNode(node);
      return owner === undefined ? [] : [canvasPlacementOwnerKey(owner)];
    })
  );
  return (input.layout?.nodes ?? []).filter((node) => {
    const ownerKey = canvasLayoutNodeKey(node);
    if (renderedOwnerKeys.has(ownerKey)) {
      return true;
    }
    return input.retainedLayoutOwnerKeys?.has(ownerKey) === true;
  });
}

function placementCandidateKey(input: {
  owner: CanvasPlacementOwner | undefined;
  ref: CanvasLayoutResourceRef | undefined;
}): string | undefined {
  if (input.owner !== undefined) {
    return canvasPlacementOwnerKey(input.owner);
  }
  if (input.ref !== undefined) {
    return canvasResourceKey(input.ref);
  }
  return undefined;
}

export function placeCanvasNodesWithLayout({
  connections,
  initialPositionByNodeId,
  initialPositionByRef,
  layout,
  nodes,
  retainedLayoutOwnerKeys,
}: PlaceCanvasNodesOptions): PlaceCanvasNodesResult {
  const savedByRef = savedPositionByRef(layout);
  const savedByOwner = savedPositionByOwner(layout);
  const positionByRef = new Map(savedByRef);
  const anchorIndex = createPlacementAnchorIndex(connections);
  const occupiedLayoutNodes = occupancyLayoutNodes({
    layout,
    nodes,
    retainedLayoutOwnerKeys,
  });
  const occupancy = new PlacementOccupancy(
    occupiedLayoutNodes.map((node) =>
      rectFromPosition(node.position, layoutNodeFootprintHeight(node))
    )
  );
  const placedNodes = [...nodes];
  const placedLayoutNodes: CanvasLayoutNode[] = [];
  const placementCandidates: PlacementCandidate[] = [];

  placedNodes.forEach((node, index) => {
    const ref = canvasResourceIdentityFromNode(node);
    const owner = canvasPlacementOwnerFromNode(node);
    const key = placementCandidateKey({ owner, ref });
    const savedPosition = key === undefined ? undefined : savedByOwner.get(key);
    if (savedPosition !== undefined) {
      placedNodes[index] = nodeWithPosition(node, savedPosition);
      return;
    }
    if (ref === undefined && isPlacedDeploymentPlaceholderNode(node)) {
      occupancy.allocateFootprint(
        singleNodeFootprint(nodeFootprintHeight(node)),
        node.position
      );
      return;
    }

    placementCandidates.push({
      index,
      node,
      owner,
      ref,
      sortKey: key ?? `Unknown:${index}:${node.id}`,
    });
  });

  for (const unit of buildPlacementUnits(placementCandidates)) {
    const footprint = placementUnitFootprint(unit);
    const placement = placementForUnit(
      unit,
      anchorIndex,
      initialPositionByNodeId,
      initialPositionByRef,
      positionByRef,
      occupancy
    );
    occupancy.allocateFootprint(footprint, placement);
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
