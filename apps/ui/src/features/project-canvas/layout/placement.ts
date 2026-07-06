import type { Node } from "@xyflow/react";

import type { CanvasDetectedConnection } from "../flow/detected-connections";
import {
  canvasPublicAccessApResourceIdentityFromNode,
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import {
  anchorCandidatePositions,
  firstAnchoredPosition,
} from "./anchored-placement";
import {
  firstOpenGlobalPosition,
  firstOpenRegenerationPosition,
  regenerationColumnCap,
} from "./global-placement";
import {
  createPlacementAnchorIndex,
  type PlacementAnchorIndex,
} from "./placement-anchors";
import {
  type PlacementFootprint,
  rectFromPosition,
  singleNodeFootprint,
} from "./placement-geometry";
import {
  isCanvasNodeGeneratedPosition as isCanvasNodeGeneratedPositionFromNode,
  isPlacedDeploymentPlaceholderNode,
  layoutNodeFootprintHeight,
  layoutNodeFromPlacedNode,
  nodeFootprintHeight,
  nodeWithGeneratedPosition,
  nodeWithPosition,
} from "./placement-node";
import { PlacementOccupancy } from "./placement-occupancy";
import {
  canvasLayoutNodeKey,
  canvasLayoutNodeResourceRef,
  canvasPlacementOwnerFromNode,
  canvasPlacementOwnerKey,
} from "./placement-owner";
import {
  buildPlacementUnits,
  type CanvasClusterCandidate,
  type DeploymentProjectionFootprintCandidate,
  type PlacementCandidate,
  type PlacementUnit,
  placementUnitCandidatePositions,
  placementUnitFootprint,
  publicAccessAnchorPositions,
  singleCandidateFootprint,
} from "./placement-units";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasLayoutResourceRef,
  CanvasPlacementOwner,
} from "./types";

export function isCanvasNodeGeneratedPosition(node: Node | undefined): boolean {
  return isCanvasNodeGeneratedPositionFromNode(node);
}

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
    publicAccessAnchorPositions(apPosition),
    nodeFootprintHeight(candidate.node)
  );
}

/**
 * Picks the global fallback strategy for one placement run: the append-only
 * scan for Incremental Canvas Placement, or the backfilling grid scan for
 * whole-canvas regeneration.
 */
type GlobalPlacement = (footprint: PlacementFootprint) => CanvasLayoutPosition;

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
  for (const { candidate, position } of placementUnitCandidatePositions(
    unit,
    origin
  )) {
    placeCandidateAt(
      candidate,
      position,
      positionByRef,
      placedNodes,
      placedLayoutNodes
    );
  }
}

function placementForSingleUnit(
  candidate: PlacementCandidate,
  anchorIndex: PlacementAnchorIndex,
  initialPositionByNodeId:
    | ReadonlyMap<string, CanvasLayoutPosition>
    | undefined,
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy,
  globalPlacement: GlobalPlacement
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
  return publicAccessPosition ?? anchored ?? globalPlacement(footprint);
}

function placementForDeploymentProjectionFootprint(
  projection: DeploymentProjectionFootprintCandidate,
  occupancy: PlacementOccupancy,
  globalPlacement: GlobalPlacement
): CanvasLayoutPosition {
  const firstCandidate = projection.candidates[0];
  const relative =
    firstCandidate === undefined
      ? undefined
      : projection.relativePositions.get(firstCandidate.index);
  const initialOrigin =
    firstCandidate === undefined || relative === undefined
      ? undefined
      : {
          x: firstCandidate.node.position.x - relative.x,
          y: firstCandidate.node.position.y - relative.y,
        };
  if (initialOrigin !== undefined && projection.source === "user") {
    return initialOrigin;
  }
  if (
    initialOrigin !== undefined &&
    occupancy.isFootprintOpen(projection.footprint, initialOrigin)
  ) {
    return initialOrigin;
  }
  return globalPlacement(projection.footprint);
}

/**
 * Places a Canvas Placement Cluster: tries every member's connection anchors
 * against already-placed neighbours (offset by the member's position inside
 * the cluster) so incremental clusters still snuggle up to their placed
 * counterparts, then falls back to global placement.
 */
function placementForCluster(
  cluster: CanvasClusterCandidate,
  anchorIndex: PlacementAnchorIndex,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy,
  globalPlacement: GlobalPlacement
): CanvasLayoutPosition {
  for (const member of cluster.candidates) {
    const relative = cluster.relativePositions.get(member.index) ?? {
      x: 0,
      y: 0,
    };
    for (const anchor of anchorIndex.anchorsForRef(member.ref)) {
      for (const anchorPosition of anchorCandidatePositions(
        anchor,
        positionByRef
      )) {
        const origin = {
          x: anchorPosition.x - relative.x,
          y: anchorPosition.y - relative.y,
        };
        if (occupancy.isFootprintOpen(cluster.footprint, origin)) {
          return origin;
        }
      }
    }
  }
  return globalPlacement(cluster.footprint);
}

function placementForUnit(
  unit: PlacementUnit,
  anchorIndex: PlacementAnchorIndex,
  initialPositionByNodeId:
    | ReadonlyMap<string, CanvasLayoutPosition>
    | undefined,
  initialPositionByRef: ReadonlyMap<string, CanvasLayoutPosition> | undefined,
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy,
  globalPlacement: GlobalPlacement
): CanvasLayoutPosition {
  if (unit.kind === "single") {
    return placementForSingleUnit(
      unit.candidate,
      anchorIndex,
      initialPositionByNodeId,
      initialPositionByRef,
      positionByRef,
      occupancy,
      globalPlacement
    );
  }

  if (unit.kind === "deploymentProjectionFootprint") {
    return placementForDeploymentProjectionFootprint(
      unit.projection,
      occupancy,
      globalPlacement
    );
  }

  return placementForCluster(
    unit.cluster,
    anchorIndex,
    positionByRef,
    occupancy,
    globalPlacement
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

function renderedNodeByOwnerKey(nodes: readonly Node[]): Map<string, Node> {
  const byOwnerKey = new Map<string, Node>();
  for (const node of nodes) {
    const owner = canvasPlacementOwnerFromNode(node);
    if (owner !== undefined) {
      byOwnerKey.set(canvasPlacementOwnerKey(owner), node);
    }
  }
  return byOwnerKey;
}

function occupancyLayoutNodes(input: {
  layout: CanvasLayoutDocument | undefined;
  renderedByOwnerKey: ReadonlyMap<string, Node>;
  retainedLayoutOwnerKeys?: ReadonlySet<string>;
}): CanvasLayoutNode[] {
  return (input.layout?.nodes ?? []).filter((node) => {
    const ownerKey = canvasLayoutNodeKey(node);
    if (input.renderedByOwnerKey.has(ownerKey)) {
      return true;
    }
    return input.retainedLayoutOwnerKeys?.has(ownerKey) === true;
  });
}

/**
 * Occupancy height for an already-placed layout entry: the rendered card is
 * the truth (its measured height), so ghost entries without a rendered node
 * are the only ones sized by the layout entry's expansion constants.
 */
function occupiedLayoutNodeHeight(
  node: CanvasLayoutNode,
  renderedByOwnerKey: ReadonlyMap<string, Node>
): number {
  const rendered = renderedByOwnerKey.get(canvasLayoutNodeKey(node));
  return rendered === undefined
    ? layoutNodeFootprintHeight(node)
    : nodeFootprintHeight(rendered);
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
  const renderedByOwnerKey = renderedNodeByOwnerKey(nodes);
  const occupiedLayoutNodes = occupancyLayoutNodes({
    layout,
    renderedByOwnerKey,
    retainedLayoutOwnerKeys,
  });
  const occupancy = new PlacementOccupancy(
    occupiedLayoutNodes.map((node) =>
      rectFromPosition(
        node.position,
        occupiedLayoutNodeHeight(node, renderedByOwnerKey)
      )
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

  const units = buildPlacementUnits(
    placementCandidates,
    initialPositionByRef,
    connections
  );
  const columnCap =
    layout === undefined
      ? regenerationColumnCap(
          units.map(placementUnitFootprint),
          occupancy.rects
        )
      : undefined;
  const globalPlacement: GlobalPlacement = (footprint) =>
    columnCap === undefined
      ? firstOpenGlobalPosition(occupancy, footprint)
      : firstOpenRegenerationPosition(occupancy, footprint, columnCap);

  for (const unit of units) {
    const footprint = placementUnitFootprint(unit);
    const placement = placementForUnit(
      unit,
      anchorIndex,
      initialPositionByNodeId,
      initialPositionByRef,
      positionByRef,
      occupancy,
      globalPlacement
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
