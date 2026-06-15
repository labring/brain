import type { CanvasLayoutDocument, CanvasLayoutNode } from "./types";

export interface CanvasLayoutCleanupOptions {
  now?: Date;
}

export function cloneCanvasLayoutNode(
  node: CanvasLayoutNode
): CanvasLayoutNode {
  const clone: CanvasLayoutNode =
    node.owner.kind === "resource"
      ? {
          owner: { kind: "resource", ref: { ...node.owner.ref } },
          position: { x: node.position.x, y: node.position.y },
        }
      : {
          owner: {
            kind: "deploymentProjection",
            slotId: node.owner.slotId,
            taskId: node.owner.taskId,
          },
          position: { x: node.position.x, y: node.position.y },
        };
  if (node.expanded !== undefined) {
    clone.expanded = node.expanded;
  }
  if (node.lastSeenUid !== undefined) {
    clone.lastSeenUid = node.lastSeenUid;
  }
  if (node.source !== undefined) {
    clone.source = node.source;
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
    projectId: layout.projectId,
    version: layout.version,
  };
  if (layout.projectNameSnapshot !== undefined) {
    clone.projectNameSnapshot = layout.projectNameSnapshot;
  }
  return clone;
}

export function cleanupCanvasLayoutDocument(
  layout: CanvasLayoutDocument,
  _options?: CanvasLayoutCleanupOptions
): CanvasLayoutDocument {
  return cloneCanvasLayoutDocument(layout);
}
