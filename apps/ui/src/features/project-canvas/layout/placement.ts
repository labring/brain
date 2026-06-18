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
import { firstOpenGlobalPosition } from "./global-placement";
import {
  createPlacementAnchorIndex,
  type PlacementAnchor,
  type PlacementAnchorIndex,
} from "./placement-anchors";
import { rectFromPosition, singleNodeFootprint } from "./placement-geometry";
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
  type CanvasPlacementGroupCandidate,
  canvasPlacementGroupOriginFromApPosition,
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

function firstAnchoredCanvasPlacementGroupPosition(
  group: CanvasPlacementGroupCandidate,
  anchors: readonly PlacementAnchor[],
  positionByRef: ReadonlyMap<string, CanvasLayoutPosition>,
  occupancy: PlacementOccupancy
): CanvasLayoutPosition | undefined {
  for (const anchor of anchors) {
    for (const apPosition of anchorCandidatePositions(anchor, positionByRef)) {
      const origin = canvasPlacementGroupOriginFromApPosition(apPosition);
      if (occupancy.isFootprintOpen(group.footprint, origin)) {
        return origin;
      }
    }
  }
  return undefined;
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

function placementForDeploymentProjectionFootprint(
  projection: DeploymentProjectionFootprintCandidate,
  occupancy: PlacementOccupancy
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
  return firstOpenGlobalPosition(occupancy, projection.footprint);
}

function placementForCanvasPlacementGroup(
  group: CanvasPlacementGroupCandidate,
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
      : canvasPlacementGroupOriginFromApPosition(apInitialPosition);
  if (
    initialGroupOrigin !== undefined &&
    occupancy.isFootprintOpen(group.footprint, initialGroupOrigin)
  ) {
    return initialGroupOrigin;
  }
  const position = firstAnchoredCanvasPlacementGroupPosition(
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

  if (unit.kind === "deploymentProjectionFootprint") {
    return placementForDeploymentProjectionFootprint(
      unit.projection,
      occupancy
    );
  }

  return placementForCanvasPlacementGroup(
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

  for (const unit of buildPlacementUnits(
    placementCandidates,
    initialPositionByRef
  )) {
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
