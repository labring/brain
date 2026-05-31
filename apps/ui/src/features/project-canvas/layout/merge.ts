import type { Node } from "@xyflow/react";

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
import {
  applyCanvasStackOrderToNodes,
  canvasNodeStackOrder,
  nodeWithCanvasStackOrder,
} from "./node-stack-order";
import { placeCanvasNodes } from "./placement";
import {
  CANVAS_STACK_ORDER_RETURN_STABILITY_MS,
  canvasStackOrderValue,
  nextExplicitCanvasStackOrder,
} from "./stack-order";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutPosition,
} from "./types";

export interface CanvasLayoutMergeResult {
  changed: boolean;
  layout: CanvasLayoutDocument | undefined;
  nodes: Node[];
}

export interface CanvasLayoutMergeOptions {
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

export function canvasLayoutNodeFromNode(
  node: Node
): CanvasLayoutNode | undefined {
  const ref = canvasResourceIdentityFromNode(node);
  const position = finitePosition(node.position);
  if (ref === undefined || position === undefined) {
    return undefined;
  }
  const expanded = canvasLayoutExpandedFromNode(node) ?? false;
  const lastSeenUid = canvasResourceLastSeenUidFromNode(node);
  const stackOrder = canvasNodeStackOrder(node);
  return {
    expanded,
    ...(lastSeenUid === undefined ? {} : { lastSeenUid }),
    position,
    ref,
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
    a.projectNameSnapshot === b.projectNameSnapshot &&
    a.projectUid === b.projectUid &&
    a.version === b.version &&
    a.nodes.length === b.nodes.length &&
    a.nodes.every((node, index) => {
      const other = b.nodes[index];
      return other !== undefined && layoutNodesEqual(node, other);
    })
  );
}

function layoutNodesEqual(a: CanvasLayoutNode, b: CanvasLayoutNode): boolean {
  return (
    a.expanded === b.expanded &&
    a.lastSeenUid === b.lastSeenUid &&
    a.orphanedAt === b.orphanedAt &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.ref.kind === b.ref.kind &&
    a.ref.name === b.ref.name &&
    a.ref.namespace === b.ref.namespace &&
    a.stackOrder === b.stackOrder
  );
}

function restoredLayoutNodeFromDetectedNode(
  saved: CanvasLayoutNode,
  detected: Node
): CanvasLayoutNode {
  const lastSeenUid =
    canvasResourceLastSeenUidFromNode(detected) ?? saved.lastSeenUid;
  const restored: CanvasLayoutNode = {
    position: { x: saved.position.x, y: saved.position.y },
    ref: { ...saved.ref },
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
  layout,
  nodes,
  now = new Date(),
}: CanvasLayoutMergeOptions): CanvasLayoutMergeResult {
  if (layout === undefined) {
    return {
      changed: false,
      layout: undefined,
      nodes: applyCanvasStackOrderToNodes(placeCanvasNodes({ layout, nodes })),
    };
  }

  const nowIso = now.toISOString();
  const cleanedLayout = cleanupCanvasLayoutDocument(layout, { now });
  let nextFreshStackOrder = nextExplicitCanvasStackOrder(cleanedLayout.nodes);
  const layoutByRef = new Map<string, CanvasLayoutNode>();
  for (const item of cleanedLayout.nodes) {
    layoutByRef.set(canvasResourceKey(item.ref), item);
  }

  const nextLayoutByRef = new Map<string, CanvasLayoutNode>();
  const renderedNodes = nodes.map((node) => {
    const ref = canvasResourceIdentityFromNode(node);
    if (ref === undefined) {
      return { ...node };
    }

    const key = canvasResourceKey(ref);
    const saved = layoutByRef.get(key);
    if (saved === undefined) {
      return { ...node };
    }

    const restored = restoredLayoutNodeFromDetectedNode(saved, node);
    if (shouldBringRestoredLayoutNodeToFront(saved, node, now)) {
      restored.stackOrder = nextFreshStackOrder;
      nextFreshStackOrder += 1;
    }
    nextLayoutByRef.set(key, restored);

    const savedPosition = finitePosition(saved.position);
    const positioned =
      savedPosition === undefined
        ? { ...node }
        : { ...node, position: savedPosition };
    const expandedNode = withCanvasLayoutExpansion(positioned, saved.expanded);
    const stackOrder = canvasStackOrderValue(restored.stackOrder);
    return stackOrder === undefined
      ? expandedNode
      : nodeWithCanvasStackOrder(expandedNode, stackOrder);
  });

  const nextLayout = cloneCanvasLayoutDocument(cleanedLayout);
  nextLayout.nodes = cleanedLayout.nodes.map((item) => {
    const key = canvasResourceKey(item.ref);
    const live = nextLayoutByRef.get(key);
    if (live !== undefined) {
      return live;
    }
    return orphanedLayoutNode(item, nowIso);
  });

  return {
    changed: !layoutDocumentsEqual(layout, nextLayout),
    layout: nextLayout,
    nodes: applyCanvasStackOrderToNodes(
      placeCanvasNodes({ layout: cleanedLayout, nodes: renderedNodes })
    ),
  };
}

export function applyCanvasLayoutToNodes(
  nodes: Node[],
  layout: CanvasLayoutDocument | undefined
): Node[] {
  return mergeCanvasLayoutWithDetectedNodes({ layout, nodes }).nodes;
}
