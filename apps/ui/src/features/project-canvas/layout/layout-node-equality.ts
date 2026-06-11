import { canvasResourceKey } from "../nodes/resource-identity";
import type { CanvasLayoutNode } from "./types";

export function canvasLayoutNodeKey(node: CanvasLayoutNode): string {
  return canvasResourceKey(node.ref);
}

export function canvasLayoutNodesEqual(
  a: CanvasLayoutNode,
  b: CanvasLayoutNode
): boolean {
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
    orphanedAt: canvasLayoutNodeOrphanedAtSignature(node, options),
    position: node.position,
    ref: node.ref,
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
