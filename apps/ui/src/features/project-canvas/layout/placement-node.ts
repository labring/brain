import type { Node } from "@xyflow/react";

import { CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE } from "../nodes/constants";
import { canvasResourceLastSeenUidFromNode } from "../nodes/resource-identity";
import {
  CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED,
  CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED,
} from "./placement-geometry";
import type {
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasPlacementOwner,
} from "./types";

const GENERATED_POSITION_SOURCE = "generated";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function isNodeExpanded(node: Node): boolean {
  const layout = asRecord(asRecord(node.data)?.layout);
  return layout?.expanded === true;
}

export function layoutNodeFootprintHeight(node: CanvasLayoutNode): number {
  return node.expanded === true
    ? CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED
    : CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED;
}

export function nodeFootprintHeight(node: Node): number {
  return isNodeExpanded(node)
    ? CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED
    : CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED;
}

function hasFinitePosition(node: Node): boolean {
  return Number.isFinite(node.position.x) && Number.isFinite(node.position.y);
}

export function isPlacedDeploymentPlaceholderNode(node: Node): boolean {
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

export function nodeWithPosition(
  node: Node,
  position: CanvasLayoutPosition
): Node {
  if (node.position.x === position.x && node.position.y === position.y) {
    return node;
  }
  return {
    ...node,
    position: { x: position.x, y: position.y },
  };
}

export function nodeWithGeneratedPosition(
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

export function layoutNodeFromPlacedNode(
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
