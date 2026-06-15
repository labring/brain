import {
  canvasLayoutNodeKey,
  canvasLayoutNodeResourceRef,
} from "./placement-owner";
import type { CanvasLayoutNode } from "./types";

export function canvasLayoutNodesEqual(
  a: CanvasLayoutNode,
  b: CanvasLayoutNode
): boolean {
  const aRef = canvasLayoutNodeResourceRef(a);
  const bRef = canvasLayoutNodeResourceRef(b);
  return (
    a.expanded === b.expanded &&
    a.lastSeenUid === b.lastSeenUid &&
    canvasLayoutNodeKey(a) === canvasLayoutNodeKey(b) &&
    a.orphanedAt === b.orphanedAt &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    aRef?.kind === bRef?.kind &&
    aRef?.name === bRef?.name &&
    aRef?.namespace === bRef?.namespace &&
    a.source === b.source &&
    a.stackOrder === b.stackOrder
  );
}

export function canvasLayoutNodeSignature(node: CanvasLayoutNode): string {
  return canvasLayoutNodeSignatureWithOptions(node, {
    normalizeOrphanedAt: false,
  });
}

export function canvasLayoutNodeCanonicalSignature(
  node: CanvasLayoutNode
): string {
  return canvasLayoutNodeSignatureWithOptions(node, {
    normalizeOrphanedAt: true,
  });
}

export function canvasLayoutNodesSignature(
  nodes: readonly CanvasLayoutNode[]
): string {
  return canvasLayoutNodesSignatureWithOptions(nodes, {
    normalizeOrphanedAt: false,
  });
}

export function canvasLayoutNodesCanonicalSignature(
  nodes: readonly CanvasLayoutNode[]
): string {
  return canvasLayoutNodesSignatureWithOptions(nodes, {
    normalizeOrphanedAt: true,
  });
}

function canvasLayoutNodeSignatureWithOptions(
  node: CanvasLayoutNode,
  options: { normalizeOrphanedAt: boolean }
): string {
  return JSON.stringify({
    expanded: node.expanded ?? null,
    lastSeenUid: node.lastSeenUid ?? null,
    owner: canvasLayoutNodeKey(node),
    orphanedAt: canvasLayoutNodeOrphanedAtSignature(node, options),
    position: node.position,
    ref: canvasLayoutNodeResourceRef(node) ?? null,
    source: node.source ?? null,
    stackOrder: node.stackOrder ?? null,
  });
}

function canvasLayoutNodesSignatureWithOptions(
  nodes: readonly CanvasLayoutNode[],
  options: { normalizeOrphanedAt: boolean }
): string {
  return nodes
    .map((node) => {
      const signature = canvasLayoutNodeSignatureWithOptions(node, options);
      return `${canvasLayoutNodeKey(node)}:${signature}`;
    })
    .sort()
    .join("|");
}

function canvasLayoutNodeOrphanedAtSignature(
  node: CanvasLayoutNode,
  options: { normalizeOrphanedAt: boolean }
): string | null {
  if (!options.normalizeOrphanedAt) {
    return node.orphanedAt ?? null;
  }
  return node.orphanedAt === undefined ? null : "present";
}
