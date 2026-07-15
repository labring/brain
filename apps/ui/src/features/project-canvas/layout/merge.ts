import type { Node } from "@xyflow/react";

import type { CanvasDetectedConnection } from "../flow/detected-connections";
import { CANVAS_RESOURCE_NODE_DEFAULT_EXPANDED } from "../nodes/constants";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
  canvasResourceLastSeenUidFromNode,
} from "../nodes/resource-identity";
import {
  cleanupCanvasLayoutDocument,
  cloneCanvasLayoutDocument,
  cloneCanvasLayoutNode,
} from "./cleanup";
import { canvasLayoutNodesEqual } from "./layout-node-equality";
import {
  applyCanvasStackOrderToNodes,
  canvasNodeStackOrder,
  nodeWithCanvasStackOrder,
} from "./node-stack-order";
import { placeCanvasNodesWithLayout } from "./placement";
import {
  canvasLayoutNodeResourceRef,
  canvasPlacementOwnerFromNode,
} from "./placement-owner";
import {
  canvasStackOrderValue,
  nextExplicitCanvasStackOrder,
} from "./stack-order";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasPlacementSource,
} from "./types";

export interface CanvasLayoutMergeResult {
  changed: boolean;
  layout: CanvasLayoutDocument | undefined;
  nodes: Node[];
  placedLayoutNodes: CanvasLayoutNode[];
}

export interface CanvasLayoutMergeOptions {
  connections?: readonly CanvasDetectedConnection[];
  initialPositionByNodeId?: ReadonlyMap<string, CanvasLayoutPosition>;
  initialPositionByRef?: ReadonlyMap<string, CanvasLayoutPosition>;
  layout: CanvasLayoutDocument | undefined;
  nodes: Node[];
  now?: Date;
  retainedLayoutOwnerKeys?: ReadonlySet<string>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function finitePosition(
  position: CanvasLayoutPosition | undefined
): CanvasLayoutPosition | undefined {
  if (
    position == null ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    return undefined;
  }
  return { x: position.x, y: position.y };
}

function positionsEqual(
  a: CanvasLayoutPosition,
  b: CanvasLayoutPosition
): boolean {
  return a.x === b.x && a.y === b.y;
}

function canvasLayoutExpandedFromNode(node: Node): boolean | undefined {
  const data = asRecord(node.data);
  const layout = asRecord(data?.layout);
  return typeof layout?.expanded === "boolean" ? layout.expanded : undefined;
}

function withCanvasLayoutExpansion(
  node: Node,
  expanded: boolean | undefined
): Node {
  if (expanded === undefined) {
    return node;
  }
  if (canvasLayoutExpandedFromNode(node) === expanded) {
    return node;
  }

  const data = asRecord(node.data) ?? {};
  const layout = asRecord(data.layout) ?? {};
  return {
    ...node,
    data: {
      ...data,
      layout: {
        ...layout,
        expanded,
      },
    },
  };
}

function withCanvasLayoutPosition(
  node: Node,
  position: CanvasLayoutPosition | undefined
): Node {
  if (position === undefined || positionsEqual(node.position, position)) {
    return node;
  }
  return { ...node, position: { x: position.x, y: position.y } };
}

export function canvasLayoutNodeFromNode(
  node: Node,
  options?: { source?: CanvasPlacementSource }
): CanvasLayoutNode | undefined {
  const owner = canvasPlacementOwnerFromNode(node);
  const position = finitePosition(node.position);
  if (owner === undefined || position === undefined) {
    return undefined;
  }
  if (owner.kind === "deploymentProjection") {
    return {
      owner,
      position,
      ...(options?.source === undefined ? {} : { source: options.source }),
    };
  }
  const expanded =
    canvasLayoutExpandedFromNode(node) ?? CANVAS_RESOURCE_NODE_DEFAULT_EXPANDED;
  const lastSeenUid = canvasResourceLastSeenUidFromNode(node);
  const stackOrder = canvasNodeStackOrder(node);
  return {
    expanded,
    ...(lastSeenUid === undefined ? {} : { lastSeenUid }),
    owner,
    position,
    ...(options?.source === undefined ? {} : { source: options.source }),
    ...(stackOrder === undefined ? {} : { stackOrder }),
  };
}

function hasDifferentDetectedUid(
  saved: CanvasLayoutNode,
  detected: Node
): boolean {
  const savedUid = saved.lastSeenUid?.trim();
  const detectedUid = canvasResourceLastSeenUidFromNode(detected);
  return (
    savedUid !== undefined &&
    savedUid !== "" &&
    detectedUid !== undefined &&
    savedUid !== detectedUid
  );
}

function shouldBringRestoredLayoutNodeToFront(
  saved: CanvasLayoutNode,
  detected: Node
): boolean {
  return hasDifferentDetectedUid(saved, detected);
}

function layoutDocumentsEqual(
  a: CanvasLayoutDocument | undefined,
  b: CanvasLayoutDocument | undefined
): boolean {
  if (a === undefined || b === undefined) {
    return a === b;
  }
  return (
    a.namespace === b.namespace &&
    a.projectId === b.projectId &&
    a.projectNameSnapshot === b.projectNameSnapshot &&
    a.version === b.version &&
    a.nodes.length === b.nodes.length &&
    a.nodes.every((node, index) => {
      const other = b.nodes[index];
      return other !== undefined && canvasLayoutNodesEqual(node, other);
    })
  );
}

function restoredLayoutNodeFromDetectedNode(
  saved: CanvasLayoutNode,
  detected: Node
): CanvasLayoutNode {
  const lastSeenUid =
    canvasResourceLastSeenUidFromNode(detected) ?? saved.lastSeenUid;
  const ref = canvasLayoutNodeResourceRef(saved);
  if (ref === undefined) {
    return cloneCanvasLayoutNode(saved);
  }
  const restored: CanvasLayoutNode = {
    owner: { kind: "resource", ref: { ...ref } },
    position: { x: saved.position.x, y: saved.position.y },
  };
  if (saved.expanded !== undefined) {
    restored.expanded = saved.expanded;
  }
  if (lastSeenUid !== undefined) {
    restored.lastSeenUid = lastSeenUid;
  }
  if (saved.source !== undefined) {
    restored.source = saved.source;
  }
  if (saved.stackOrder !== undefined) {
    restored.stackOrder = saved.stackOrder;
  }
  return restored;
}

export function mergeCanvasLayoutWithDetectedNodes({
  connections,
  initialPositionByNodeId,
  initialPositionByRef,
  layout,
  nodes,
  now = new Date(),
  retainedLayoutOwnerKeys,
}: CanvasLayoutMergeOptions): CanvasLayoutMergeResult {
  if (layout === undefined) {
    const placed = placeCanvasNodesWithLayout({
      connections,
      initialPositionByNodeId,
      initialPositionByRef,
      layout,
      nodes,
      retainedLayoutOwnerKeys,
    });
    return {
      changed: false,
      layout: undefined,
      nodes: applyCanvasStackOrderToNodes(placed.nodes),
      placedLayoutNodes: placed.placedLayoutNodes,
    };
  }

  const cleanedLayout = cleanupCanvasLayoutDocument(layout, { now });
  let nextFreshStackOrder = nextExplicitCanvasStackOrder(cleanedLayout.nodes);
  const layoutByRef = new Map<string, CanvasLayoutNode>();
  for (const item of cleanedLayout.nodes) {
    const ref = canvasLayoutNodeResourceRef(item);
    if (ref !== undefined) {
      layoutByRef.set(canvasResourceKey(ref), item);
    }
  }

  const nextLayoutByRef = new Map<string, CanvasLayoutNode>();
  const renderedNodes = nodes.map((node) => {
    const ref = canvasResourceIdentityFromNode(node);
    if (ref === undefined) {
      return node;
    }

    const key = canvasResourceKey(ref);
    const saved = layoutByRef.get(key);
    if (saved === undefined) {
      return node;
    }

    const restored = restoredLayoutNodeFromDetectedNode(saved, node);
    if (shouldBringRestoredLayoutNodeToFront(saved, node)) {
      restored.stackOrder = nextFreshStackOrder;
      nextFreshStackOrder += 1;
    }
    nextLayoutByRef.set(key, restored);

    const savedPosition = finitePosition(saved.position);
    const positioned = withCanvasLayoutPosition(node, savedPosition);
    const expandedNode = withCanvasLayoutExpansion(positioned, saved.expanded);
    const stackOrder = canvasStackOrderValue(restored.stackOrder);
    return stackOrder === undefined
      ? expandedNode
      : nodeWithCanvasStackOrder(expandedNode, stackOrder);
  });

  const nextLayout = cloneCanvasLayoutDocument(cleanedLayout);
  nextLayout.nodes = cleanedLayout.nodes.map((item) => {
    const ref = canvasLayoutNodeResourceRef(item);
    if (ref === undefined) {
      return item;
    }
    const key = canvasResourceKey(ref);
    const live = nextLayoutByRef.get(key);
    if (live !== undefined) {
      return live;
    }
    return cloneCanvasLayoutNode(item);
  });

  const placed = placeCanvasNodesWithLayout({
    connections,
    initialPositionByNodeId,
    initialPositionByRef,
    layout: cleanedLayout,
    nodes: renderedNodes,
    retainedLayoutOwnerKeys,
  });
  return {
    changed: !layoutDocumentsEqual(layout, nextLayout),
    layout: nextLayout,
    nodes: applyCanvasStackOrderToNodes(placed.nodes),
    placedLayoutNodes: placed.placedLayoutNodes,
  };
}

export function applyCanvasLayoutToNodes(
  nodes: Node[],
  layout: CanvasLayoutDocument | undefined
): Node[] {
  return mergeCanvasLayoutWithDetectedNodes({ layout, nodes }).nodes;
}
