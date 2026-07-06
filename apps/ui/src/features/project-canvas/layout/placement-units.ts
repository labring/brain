import type { Node } from "@xyflow/react";

import type { CanvasDetectedConnection } from "../flow/detected-connections";
import { canvasResourceKey } from "../nodes/resource-identity";
import {
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
  CanvasPlacementSource,
} from "./types";

export interface PlacementCandidate {
  index: number;
  node: Node;
  owner: CanvasPlacementOwner | undefined;
  ref: CanvasLayoutResourceRef | undefined;
  sortKey: string;
}

type ClusterMember = PlacementCandidate & { ref: CanvasLayoutResourceRef };

/**
 * A connected component of unplaced resource nodes (PA—AP by naming, AP—DB
 * by detected connection) laid out internally as `PA | AP | DB` columns and
 * placed as one rigid unit. The footprint is the component's bounding box so
 * foreign nodes never backfill into gaps between cluster members.
 */
export interface CanvasClusterCandidate {
  candidates: ClusterMember[];
  footprint: PlacementFootprint;
  relativePositions: Map<number, CanvasLayoutPosition>;
  sortKey: string;
}

export interface DeploymentProjectionFootprintCandidate {
  candidates: PlacementCandidate[];
  footprint: PlacementFootprint;
  relativePositions: Map<number, CanvasLayoutPosition>;
  sortKey: string;
  source?: CanvasPlacementSource;
}

export type PlacementUnit =
  | { candidate: PlacementCandidate; kind: "single" }
  | { cluster: CanvasClusterCandidate; kind: "cluster" }
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
  if (unit.kind === "cluster") {
    return unit.cluster.sortKey;
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
  return unit.kind === "cluster"
    ? unit.cluster.footprint
    : unit.projection.footprint;
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
): candidate is ClusterMember {
  return candidate.ref !== undefined;
}

function initialPositionForCandidate(
  candidate: ClusterMember,
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined
): CanvasLayoutPosition | undefined {
  return initialPositionByRef?.get(canvasResourceKey(candidate.ref));
}

function deploymentProjectionFootprintInfo(candidate: PlacementCandidate):
  | {
      groupId: string;
      relativePosition: CanvasLayoutPosition;
      source?: CanvasPlacementSource;
    }
  | undefined {
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
    ...(data?.projectionPlacementSource === "user" ||
    data?.projectionPlacementSource === "generated"
      ? { source: data.projectionPlacementSource }
      : {}),
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
  const sourceByTask = new Map<string, CanvasPlacementSource>();
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
    if (projection.source === "user") {
      sourceByTask.set(projection.groupId, "user");
    } else if (!sourceByTask.has(projection.groupId)) {
      sourceByTask.set(projection.groupId, projection.source ?? "generated");
    }
  }

  const groupedIndexes = new Set<number>();
  const units: PlacementUnit[] = [];
  for (const [taskId, taskCandidates] of candidatesByTask) {
    const relativePositions =
      relativePositionsByTask.get(taskId) ??
      new Map<number, CanvasLayoutPosition>();
    const source = sourceByTask.get(taskId);
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
        ...(source === undefined ? {} : { source }),
        sortKey: `DeploymentProjection:${taskId}`,
      },
    });
  }
  return { groupedIndexes, units };
}

function apKeyForPublicAccessRef(ref: CanvasLayoutResourceRef): string {
  return canvasResourceKey({
    kind: "AP",
    name: ref.name,
    namespace: ref.namespace,
  });
}

function clusterRootKey(parents: Map<string, string>, key: string): string {
  let root = key;
  let parent = parents.get(root);
  while (parent !== undefined && parent !== root) {
    root = parent;
    parent = parents.get(root);
  }
  return root;
}

function compareClusterMembers(a: ClusterMember, b: ClusterMember): number {
  return a.sortKey.localeCompare(b.sortKey);
}

/**
 * Layered internal cluster layout: APs occupy rows in sort order with their
 * PublicAccess beside them; each DB's ideal row is the barycenter (mean row
 * of its connected APs), assigned in barycenter order as
 * `max(next open row, round(barycenter))` so private DBs sit level with
 * their AP and shared DBs settle between the APs they serve.
 */
function clusterUnit(
  members: readonly ClusterMember[],
  apKeysByDbKey: ReadonlyMap<string, readonly string[]>
): PlacementUnit {
  const sorted = [...members].sort(compareClusterMembers);
  const aps = sorted.filter((member) => member.ref.kind === "AP");
  const publicAccesses = sorted.filter(
    (member) => member.ref.kind === "PublicAccess"
  );
  const dbs = sorted.filter((member) => member.ref.kind === "DB");

  const apRowByKey = new Map<string, number>();
  aps.forEach((ap, row) => {
    apRowByKey.set(canvasResourceKey(ap.ref), row);
  });

  const apColumnX =
    publicAccesses.length > 0 ? PUBLIC_ACCESS_AP_LEFT_OFFSET : 0;
  const dbColumnX = apColumnX + COLUMN_STEP;

  const relativePositions = new Map<number, CanvasLayoutPosition>();
  aps.forEach((ap, row) => {
    relativePositions.set(ap.index, { x: apColumnX, y: row * ROW_STEP });
  });
  for (const publicAccess of publicAccesses) {
    const row = apRowByKey.get(apKeyForPublicAccessRef(publicAccess.ref)) ?? 0;
    relativePositions.set(publicAccess.index, {
      x: apColumnX - PUBLIC_ACCESS_AP_LEFT_OFFSET,
      y: row * ROW_STEP,
    });
  }

  const orderedDbs = dbs
    .map((db) => {
      const rows = (apKeysByDbKey.get(canvasResourceKey(db.ref)) ?? [])
        .map((apKey) => apRowByKey.get(apKey))
        .filter((row): row is number => row !== undefined);
      const barycenter =
        rows.length === 0
          ? 0
          : rows.reduce((sum, row) => sum + row, 0) / rows.length;
      return { barycenter, db };
    })
    .sort(
      (a, b) => a.barycenter - b.barycenter || compareClusterMembers(a.db, b.db)
    );
  let nextOpenDbRow = 0;
  for (const { barycenter, db } of orderedDbs) {
    const row = Math.max(nextOpenDbRow, Math.round(barycenter));
    nextOpenDbRow = row + 1;
    relativePositions.set(db.index, { x: dbColumnX, y: row * ROW_STEP });
  }

  let width = CANVAS_NODE_FOOTPRINT_WIDTH;
  let height = 0;
  for (const member of sorted) {
    const relative = relativePositions.get(member.index) ?? { x: 0, y: 0 };
    width = Math.max(width, relative.x + CANVAS_NODE_FOOTPRINT_WIDTH);
    height = Math.max(height, relative.y + nodeFootprintHeight(member.node));
  }

  return {
    cluster: {
      candidates: sorted,
      footprint: { rects: [{ height, width, x: 0, y: 0 }] },
      relativePositions,
      sortKey: sorted[0]?.sortKey ?? "",
    },
    kind: "cluster",
  };
}

function clusterEligibleMembersByKey(
  candidates: readonly PlacementCandidate[],
  groupedIndexes: ReadonlySet<number>,
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined
): Map<string, ClusterMember> {
  const membersByKey = new Map<string, ClusterMember>();
  for (const candidate of candidates) {
    if (
      groupedIndexes.has(candidate.index) ||
      !isReferencedPlacementCandidate(candidate) ||
      initialPositionForCandidate(candidate, initialPositionByRef) !== undefined
    ) {
      continue;
    }
    membersByKey.set(canvasResourceKey(candidate.ref), candidate);
  }
  return membersByKey;
}

function unionApDbClusterEdges(
  membersByKey: ReadonlyMap<string, ClusterMember>,
  connections: readonly CanvasDetectedConnection[] | undefined,
  union: (a: string, b: string) => void
): Map<string, string[]> {
  const apKeysByDbKey = new Map<string, string[]>();
  for (const connection of connections ?? []) {
    if (
      connection.kind !== "APToDB" ||
      connection.source.kind !== "AP" ||
      connection.target.kind !== "DB"
    ) {
      continue;
    }
    const apKey = canvasResourceKey(connection.source);
    const dbKey = canvasResourceKey(connection.target);
    union(apKey, dbKey);
    if (!(membersByKey.has(apKey) && membersByKey.has(dbKey))) {
      continue;
    }
    const apKeys = apKeysByDbKey.get(dbKey) ?? [];
    if (!apKeys.includes(apKey)) {
      apKeys.push(apKey);
    }
    apKeysByDbKey.set(dbKey, apKeys);
  }
  return apKeysByDbKey;
}

function connectionClusterUnits(
  candidates: readonly PlacementCandidate[],
  groupedIndexes: Set<number>,
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined,
  connections: readonly CanvasDetectedConnection[] | undefined
): PlacementUnit[] {
  const membersByKey = clusterEligibleMembersByKey(
    candidates,
    groupedIndexes,
    initialPositionByRef
  );

  const parents = new Map<string, string>();
  const union = (a: string, b: string): void => {
    if (!(membersByKey.has(a) && membersByKey.has(b))) {
      return;
    }
    const rootA = clusterRootKey(parents, a);
    const rootB = clusterRootKey(parents, b);
    if (rootA !== rootB) {
      parents.set(rootA, rootB);
    }
  };

  for (const member of membersByKey.values()) {
    if (member.ref.kind === "PublicAccess") {
      union(canvasResourceKey(member.ref), apKeyForPublicAccessRef(member.ref));
    }
  }
  const apKeysByDbKey = unionApDbClusterEdges(membersByKey, connections, union);

  const componentsByRoot = new Map<string, ClusterMember[]>();
  for (const [key, member] of membersByKey) {
    const root = clusterRootKey(parents, key);
    const component = componentsByRoot.get(root) ?? [];
    component.push(member);
    componentsByRoot.set(root, component);
  }

  const units: PlacementUnit[] = [];
  for (const component of componentsByRoot.values()) {
    if (component.length < 2) {
      continue;
    }
    for (const member of component) {
      groupedIndexes.add(member.index);
    }
    units.push(clusterUnit(component, apKeysByDbKey));
  }
  return units;
}

export function buildPlacementUnits(
  candidates: readonly PlacementCandidate[],
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined,
  connections?: readonly CanvasDetectedConnection[]
): PlacementUnit[] {
  const projectionFootprints = deploymentProjectionFootprintUnits(candidates);
  const groupedIndexes = projectionFootprints.groupedIndexes;
  const units: PlacementUnit[] = [
    ...projectionFootprints.units,
    ...connectionClusterUnits(
      candidates,
      groupedIndexes,
      initialPositionByRef,
      connections
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

  const grouped =
    unit.kind === "cluster"
      ? {
          candidates: unit.cluster.candidates as PlacementCandidate[],
          relativePositions: unit.cluster.relativePositions,
        }
      : {
          candidates: unit.projection.candidates,
          relativePositions: unit.projection.relativePositions,
        };
  return grouped.candidates.map((candidate) => {
    const relative = grouped.relativePositions.get(candidate.index) ?? {
      x: 0,
      y: 0,
    };
    return {
      candidate,
      position: { x: origin.x + relative.x, y: origin.y + relative.y },
    };
  });
}
