import type { Node } from "@xyflow/react";

import type { CanvasDetectedConnection } from "../flow/detected-connections";
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
  CANVAS_STACK_ORDER_RETURN_STABILITY_MS,
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
  const ref = owner.ref;
  const expanded = canvasLayoutExpandedFromNode(node) ?? false;
  const lastSeenUid = canvasResourceLastSeenUidFromNode(node);
  const stackOrder = canvasNodeStackOrder(node);
  return {
    expanded,
    ...(lastSeenUid === undefined ? {} : { lastSeenUid }),
    owner,
    position,
    ref,
    ...(options?.source === undefined ? {} : { source: options.source }),
    ...(stackOrder === undefined ? {} : { stackOrder }),
  };
}

function isMeaningfulOrphanReturn(saved: CanvasLayoutNode, now: Date): boolean {
  if (saved.orphanedAt === undefined) {
    return false;
  }
  const orphanedAtMs = Date.parse(saved.orphanedAt);
  return (
    Number.isFinite(orphanedAtMs) &&
    now.getTime() - orphanedAtMs > CANVAS_STACK_ORDER_RETURN_STABILITY_MS
  );
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
  detected: Node,
  now: Date
): boolean {
  return (
    isMeaningfulOrphanReturn(saved, now) ||
    hasDifferentDetectedUid(saved, detected)
  );
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
    ref: { ...ref },
  };
  if (saved.expanded !== undefined) {
    restored.expanded = saved.expanded;
  }
  if (lastSeenUid !== undefined) {
    restored.lastSeenUid = lastSeenUid;
  }
  if (saved.stackOrder !== undefined) {
    restored.stackOrder = saved.stackOrder;
  }
  return restored;
}

function orphanedLayoutNode(
  node: CanvasLayoutNode,
  orphanedAt: string
): CanvasLayoutNode {
  const orphan = cloneCanvasLayoutNode(node);
  if (orphan.orphanedAt === undefined) {
    orphan.orphanedAt = orphanedAt;
  }
  return orphan;
}

export function mergeCanvasLayoutWithDetectedNodes({
  connections,
  initialPositionByNodeId,
  initialPositionByRef,
  layout,
  nodes,
  now = new Date(),
}: CanvasLayoutMergeOptions): CanvasLayoutMergeResult {
  if (layout === undefined) {
    const placed = placeCanvasNodesWithLayout({
      connections,
      initialPositionByNodeId,
      initialPositionByRef,
      layout,
      nodes,
    });
    return {
      changed: false,
      layout: undefined,
      nodes: applyCanvasStackOrderToNodes(placed.nodes),
      placedLayoutNodes: [],
    };
  }

  const nowIso = now.toISOString();
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
    if (shouldBringRestoredLayoutNodeToFront(saved, node, now)) {
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
    return orphanedLayoutNode(item, nowIso);
  });

  const placed = placeCanvasNodesWithLayout({
    connections,
    initialPositionByNodeId,
    initialPositionByRef,
    layout: cleanedLayout,
    nodes: renderedNodes,
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
