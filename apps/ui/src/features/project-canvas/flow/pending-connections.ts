import type { Edge, Node } from "@xyflow/react";

import {
  type CanvasConnectionResourceRef,
  canvasConnectionNodeResourceRef,
  canvasConnectionResourceKey,
} from "./detected-connections";

export interface PendingApDbCanvasReference {
  id: string;
  source: CanvasConnectionResourceRef & { kind: "AP" };
  target: CanvasConnectionResourceRef & { kind: "DB" };
}

export interface PendingApDbCanvasConnectionEdgesOptions {
  existingEdges?: readonly Edge[];
  nodes: readonly Node[];
  pendingReferences: readonly PendingApDbCanvasReference[];
}

function pendingReferenceEqual(
  a: PendingApDbCanvasReference,
  b: PendingApDbCanvasReference
): boolean {
  return (
    a.id === b.id &&
    a.source.kind === b.source.kind &&
    a.source.name === b.source.name &&
    a.source.namespace === b.source.namespace &&
    a.target.kind === b.target.kind &&
    a.target.name === b.target.name &&
    a.target.namespace === b.target.namespace
  );
}

export function addPendingApDbCanvasReferences(
  current: PendingApDbCanvasReference[],
  next: readonly PendingApDbCanvasReference[]
): PendingApDbCanvasReference[] {
  let changed = false;
  const byId = new Map(current.map((reference) => [reference.id, reference]));
  for (const reference of next) {
    const existing = byId.get(reference.id);
    if (existing !== undefined && pendingReferenceEqual(existing, reference)) {
      continue;
    }
    byId.set(reference.id, reference);
    changed = true;
  }
  if (!changed) {
    return current;
  }
  return Array.from(byId.values());
}

export function removePendingApDbCanvasReferences(
  current: PendingApDbCanvasReference[],
  ids: readonly string[]
): PendingApDbCanvasReference[] {
  const idsToRemove = new Set(ids);
  if (!current.some((reference) => idsToRemove.has(reference.id))) {
    return current;
  }
  return current.filter((reference) => !idsToRemove.has(reference.id));
}

export function pendingApDbCanvasConnectionEdges({
  existingEdges = [],
  nodes,
  pendingReferences,
}: PendingApDbCanvasConnectionEdgesOptions): Edge[] {
  const nodeIdByResourceKey = new Map<string, string>();
  for (const node of nodes) {
    const ref = canvasConnectionNodeResourceRef(node);
    if (ref !== undefined) {
      nodeIdByResourceKey.set(canvasConnectionResourceKey(ref), node.id);
    }
  }

  const existingNodePairs = new Set(
    existingEdges.map((edge) => `${edge.source}->${edge.target}`)
  );
  const seenEdgeIds = new Set<string>();
  const edges: Edge[] = [];

  for (const reference of pendingReferences) {
    const sourceKey = canvasConnectionResourceKey(reference.source);
    const targetKey = canvasConnectionResourceKey(reference.target);
    const source = nodeIdByResourceKey.get(sourceKey);
    const target = nodeIdByResourceKey.get(targetKey);
    if (source === undefined || target === undefined) {
      continue;
    }
    if (existingNodePairs.has(`${source}->${target}`)) {
      continue;
    }

    const id = `pending:${sourceKey}->${targetKey}`;
    if (seenEdgeIds.has(id)) {
      continue;
    }
    seenEdgeIds.add(id);
    edges.push({
      data: { pending: true },
      id,
      source,
      target,
    });
  }

  return edges;
}
