import type { Node } from "@xyflow/react";

import { canvasResourceKey } from "../nodes/resource-identity";
import {
  apPublicAccessFootprint,
  CANVAS_NODE_FOOTPRINT_WIDTH,
  COLUMN_STEP,
  type PlacementFootprint,
  PUBLIC_ACCESS_AP_LEFT_OFFSET,
  ROW_STEP,
  singleNodeFootprint,
} from "./placement-geometry";
import { nodeFootprintHeight } from "./placement-node";
import type {
  CanvasLayoutPosition,
  CanvasLayoutResourceRef,
  CanvasPlacementOwner,
} from "./types";

export interface PlacementCandidate {
  index: number;
  node: Node;
  owner: CanvasPlacementOwner | undefined;
  ref: CanvasLayoutResourceRef | undefined;
  sortKey: string;
}

export interface CanvasPlacementGroupCandidate {
  ap: PlacementCandidate & { ref: CanvasLayoutResourceRef };
  footprint: PlacementFootprint;
  publicAccess: PlacementCandidate & { ref: CanvasLayoutResourceRef };
  sortKey: string;
}

export interface DeploymentProjectionFootprintCandidate {
  candidates: PlacementCandidate[];
  footprint: PlacementFootprint;
  relativePositions: Map<number, CanvasLayoutPosition>;
  sortKey: string;
}

export type PlacementUnit =
  | { candidate: PlacementCandidate; kind: "single" }
  | { group: CanvasPlacementGroupCandidate; kind: "canvasPlacementGroup" }
  | {
      kind: "deploymentProjectionFootprint";
      projection: DeploymentProjectionFootprintCandidate;
    };

export interface PlacementUnitCandidatePosition {
  candidate: PlacementCandidate;
  position: CanvasLayoutPosition;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function placementUnitSortKey(unit: PlacementUnit): string {
  if (unit.kind === "single") {
    return unit.candidate.sortKey;
  }
  if (unit.kind === "canvasPlacementGroup") {
    return unit.group.sortKey;
  }
  return unit.projection.sortKey;
}

function comparePlacementUnits(a: PlacementUnit, b: PlacementUnit): number {
  return placementUnitSortKey(a).localeCompare(placementUnitSortKey(b));
}

export function singleCandidateFootprint(
  candidate: PlacementCandidate
): PlacementFootprint {
  return singleNodeFootprint(nodeFootprintHeight(candidate.node));
}

export function placementUnitFootprint(
  unit: PlacementUnit
): PlacementFootprint {
  if (unit.kind === "single") {
    return singleCandidateFootprint(unit.candidate);
  }
  return unit.kind === "canvasPlacementGroup"
    ? unit.group.footprint
    : unit.projection.footprint;
}

export function canvasPlacementGroupOriginFromApPosition(
  apPosition: CanvasLayoutPosition
): CanvasLayoutPosition {
  return {
    x: apPosition.x - PUBLIC_ACCESS_AP_LEFT_OFFSET,
    y: apPosition.y,
  };
}

function canvasPlacementGroupPositionsFromOrigin(
  origin: CanvasLayoutPosition
): {
  ap: CanvasLayoutPosition;
  publicAccess: CanvasLayoutPosition;
} {
  return {
    ap: { x: origin.x + PUBLIC_ACCESS_AP_LEFT_OFFSET, y: origin.y },
    publicAccess: { x: origin.x, y: origin.y },
  };
}

export function publicAccessAnchorPositions(
  apPosition: CanvasLayoutPosition
): CanvasLayoutPosition[] {
  return [
    { x: -PUBLIC_ACCESS_AP_LEFT_OFFSET, y: 0 },
    { x: -PUBLIC_ACCESS_AP_LEFT_OFFSET, y: -ROW_STEP },
    { x: -PUBLIC_ACCESS_AP_LEFT_OFFSET, y: ROW_STEP },
    { x: 0, y: -ROW_STEP },
    { x: 0, y: ROW_STEP },
    { x: COLUMN_STEP, y: 0 },
  ].map((offset) => ({
    x: apPosition.x + offset.x,
    y: apPosition.y + offset.y,
  }));
}

function isReferencedPlacementCandidate(
  candidate: PlacementCandidate
): candidate is PlacementCandidate & { ref: CanvasLayoutResourceRef } {
  return candidate.ref !== undefined;
}

function initialPositionForCandidate(
  candidate: PlacementCandidate & { ref: CanvasLayoutResourceRef },
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined
): CanvasLayoutPosition | undefined {
  return initialPositionByRef?.get(canvasResourceKey(candidate.ref));
}

function deploymentProjectionFootprintInfo(
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

function deploymentProjectionFootprint(
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

function deploymentProjectionFootprintUnits(
  candidates: readonly PlacementCandidate[]
): { groupedIndexes: Set<number>; units: PlacementUnit[] } {
  const candidatesByTask = new Map<string, PlacementCandidate[]>();
  const relativePositionsByTask = new Map<
    string,
    Map<number, CanvasLayoutPosition>
  >();
  for (const candidate of candidates) {
    const projection = deploymentProjectionFootprintInfo(candidate);
    if (projection === undefined) {
      continue;
    }
    const taskCandidates = candidatesByTask.get(projection.groupId) ?? [];
    taskCandidates.push(candidate);
    candidatesByTask.set(projection.groupId, taskCandidates);
    const relativePositions =
      relativePositionsByTask.get(projection.groupId) ??
      new Map<number, CanvasLayoutPosition>();
    relativePositions.set(candidate.index, projection.relativePosition);
    relativePositionsByTask.set(projection.groupId, relativePositions);
  }

  const groupedIndexes = new Set<number>();
  const units: PlacementUnit[] = [];
  for (const [taskId, taskCandidates] of candidatesByTask) {
    const relativePositions =
      relativePositionsByTask.get(taskId) ??
      new Map<number, CanvasLayoutPosition>();
    for (const candidate of taskCandidates) {
      groupedIndexes.add(candidate.index);
    }
    units.push({
      kind: "deploymentProjectionFootprint",
      projection: {
        candidates: taskCandidates,
        footprint: deploymentProjectionFootprint(
          taskCandidates,
          relativePositions
        ),
        relativePositions,
        sortKey: `DeploymentProjection:${taskId}`,
      },
    });
  }
  return { groupedIndexes, units };
}

function canvasPlacementGroupUnits(
  candidates: readonly PlacementCandidate[],
  groupedIndexes: Set<number>,
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined
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
    if (
      initialPositionForCandidate(ap, initialPositionByRef) !== undefined ||
      initialPositionForCandidate(publicAccess, initialPositionByRef) !==
        undefined
    ) {
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
      kind: "canvasPlacementGroup",
    });
  }
  return units;
}

export function buildPlacementUnits(
  candidates: readonly PlacementCandidate[],
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined
): PlacementUnit[] {
  const projectionFootprints = deploymentProjectionFootprintUnits(candidates);
  const groupedIndexes = projectionFootprints.groupedIndexes;
  const units: PlacementUnit[] = [
    ...projectionFootprints.units,
    ...canvasPlacementGroupUnits(
      candidates,
      groupedIndexes,
      initialPositionByRef
    ),
  ];
  for (const candidate of candidates) {
    if (groupedIndexes.has(candidate.index)) {
      continue;
    }
    units.push({ candidate, kind: "single" });
  }

  return units.sort(comparePlacementUnits);
}

export function placementUnitCandidatePositions(
  unit: PlacementUnit,
  origin: CanvasLayoutPosition
): PlacementUnitCandidatePosition[] {
  if (unit.kind === "single") {
    return [{ candidate: unit.candidate, position: origin }];
  }

  if (unit.kind === "deploymentProjectionFootprint") {
    return unit.projection.candidates.map((candidate) => {
      const relative = unit.projection.relativePositions.get(
        candidate.index
      ) ?? {
        x: 0,
        y: 0,
      };
      return {
        candidate,
        position: { x: origin.x + relative.x, y: origin.y + relative.y },
      };
    });
  }

  const positions = canvasPlacementGroupPositionsFromOrigin(origin);
  return [
    { candidate: unit.group.ap, position: positions.ap },
    {
      candidate: unit.group.publicAccess,
      position: positions.publicAccess,
    },
  ];
}
