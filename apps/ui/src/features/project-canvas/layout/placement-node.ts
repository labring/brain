import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
  CANVAS_RESOURCE_NODE_DEFAULT_EXPANDED,
} from "../nodes/constants";
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

function isResourceCanvasNode(node: Node): boolean {
  return (
    node.type === CANVAS_CONTAINER_NODE_TYPE ||
    node.type === CANVAS_DATABASE_NODE_TYPE ||
    node.type === CANVAS_ENTRY_NODE_TYPE
  );
}

function expansionStateFromNode(node: Node): boolean | undefined {
  const layout = asRecord(asRecord(node.data)?.layout);
  return typeof layout?.expanded === "boolean" ? layout.expanded : undefined;
}

function isNodeExpanded(node: Node): boolean {
  return (
    expansionStateFromNode(node) ??
    (isResourceCanvasNode(node) ? CANVAS_RESOURCE_NODE_DEFAULT_EXPANDED : false)
  );
}

export function layoutNodeFootprintHeight(node: CanvasLayoutNode): number {
  const expanded =
    node.owner.kind === "resource"
      ? (node.expanded ?? CANVAS_RESOURCE_NODE_DEFAULT_EXPANDED)
      : node.expanded === true;
  return expanded
    ? CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED
    : CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED;
}

/**
 * Card heights are content-driven, so the measured render is the footprint
 * truth; the expansion-state constants only cover nodes that have not been
 * measured yet (first layout before render), and are sized conservatively
 * above the tallest known card so fallback placement spreads out rather than
 * overlaps. Measured heights are never persisted: the Canvas Layout document
 * stores intent (position and expansion) while height stays a read-side fact
 * of the current render, so a per-node-type height constant is not a fix — it
 * drifts the next time any card gains a row.
 */
export function nodeFootprintHeight(node: Node): number {
  const measured = node.measured?.height;
  if (
    typeof measured === "number" &&
    Number.isFinite(measured) &&
    measured > 0
  ) {
    return measured;
  }
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
    typeof layout?.expanded === "boolean"
      ? layout.expanded
      : CANVAS_RESOURCE_NODE_DEFAULT_EXPANDED;
  const lastSeenUid = canvasResourceLastSeenUidFromNode(node);
  return {
    expanded,
    ...(lastSeenUid === undefined ? {} : { lastSeenUid }),
    owner,
    position: { x: position.x, y: position.y },
    source: GENERATED_POSITION_SOURCE,
  };
}
