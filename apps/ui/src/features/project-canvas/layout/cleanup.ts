import type { CanvasLayoutDocument, CanvasLayoutNode } from "./types";

export const CANVAS_LAYOUT_ORPHAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface CanvasLayoutCleanupOptions {
  now?: Date;
}

export function cloneCanvasLayoutNode(
  node: CanvasLayoutNode
): CanvasLayoutNode {
  const clone: CanvasLayoutNode = {
    position: { x: node.position.x, y: node.position.y },
    ref: { ...node.ref },
  };
  if (node.expanded !== undefined) {
    clone.expanded = node.expanded;
  }
  if (node.lastSeenUid !== undefined) {
    clone.lastSeenUid = node.lastSeenUid;
  }
  if (node.orphanedAt !== undefined) {
    clone.orphanedAt = node.orphanedAt;
  }
  if (node.stackOrder !== undefined) {
    clone.stackOrder = node.stackOrder;
  }
  return clone;
}

export function cloneCanvasLayoutDocument(
  layout: CanvasLayoutDocument
): CanvasLayoutDocument {
  const clone: CanvasLayoutDocument = {
    namespace: layout.namespace,
    nodes: layout.nodes.map(cloneCanvasLayoutNode),
    projectUid: layout.projectUid,
    version: layout.version,
  };
  if (layout.projectNameSnapshot !== undefined) {
    clone.projectNameSnapshot = layout.projectNameSnapshot;
  }
  return clone;
}

export function isCanvasLayoutOrphanExpired(
  node: CanvasLayoutNode,
  now: Date
): boolean {
  if (node.orphanedAt === undefined) {
    return false;
  }
  const orphanedAtMs = Date.parse(node.orphanedAt);
  return (
    Number.isFinite(orphanedAtMs) &&
    now.getTime() - orphanedAtMs > CANVAS_LAYOUT_ORPHAN_RETENTION_MS
  );
}

export function cleanupCanvasLayoutDocument(
  layout: CanvasLayoutDocument,
  options?: CanvasLayoutCleanupOptions
): CanvasLayoutDocument {
  const now = options?.now ?? new Date();
  const clone = cloneCanvasLayoutDocument(layout);
  clone.nodes = clone.nodes.filter(
    (node) => !isCanvasLayoutOrphanExpired(node, now)
  );
  return clone;
}
