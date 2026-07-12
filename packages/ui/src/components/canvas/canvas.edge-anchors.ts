import type { Edge, Node } from "@xyflow/react";
import type { CanvasNodeConnectionSide } from "../canvas-node/canvas-node.types";

export interface CanvasEdgeAnchorPair {
  sourceSide: CanvasNodeConnectionSide;
  targetSide: CanvasNodeConnectionSide;
}

export interface CanvasEdgeAnchorResolverInput {
  dragging: boolean;
  edge: Edge;
  previousPair?: CanvasEdgeAnchorPair;
  sourceNode: Node;
  targetNode: Node;
}

export type CanvasEdgeAnchorResolver = (
  input: CanvasEdgeAnchorResolverInput
) => CanvasEdgeAnchorPair | null | undefined;

export interface ResolveCanvasEdgeAnchorsOptions {
  dragging: boolean;
  edges: readonly Edge[];
  nodes: readonly Node[];
  previousPairs: ReadonlyMap<string, CanvasEdgeAnchorPair>;
  resolver: CanvasEdgeAnchorResolver;
}

export interface ResolveCanvasEdgeAnchorsResult {
  anchorPairs: Map<string, CanvasEdgeAnchorPair>;
  edges: Edge[];
}

export function resolveCanvasEdgeAnchors({
  dragging,
  edges,
  nodes,
  previousPairs,
  resolver,
}: ResolveCanvasEdgeAnchorsOptions): ResolveCanvasEdgeAnchorsResult {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const anchorPairs = new Map<string, CanvasEdgeAnchorPair>();
  const resolvedEdges: Edge[] = [];
  let changed = false;

  for (const edge of edges) {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    if (sourceNode === undefined || targetNode === undefined) {
      continue;
    }

    const pair = resolver({
      dragging,
      edge,
      previousPair: previousPairs.get(edge.id),
      sourceNode,
      targetNode,
    });
    if (pair == null) {
      continue;
    }

    anchorPairs.set(edge.id, pair);
    if (
      edge.sourceHandle === pair.sourceSide &&
      edge.targetHandle === pair.targetSide
    ) {
      resolvedEdges.push(edge);
      continue;
    }

    changed = true;
    resolvedEdges.push({
      ...edge,
      sourceHandle: pair.sourceSide,
      targetHandle: pair.targetSide,
    });
  }

  if (!changed && resolvedEdges.length === edges.length) {
    // Keep input identity so unchanged node commits preserve xyflow's per-edge memo.
    return { anchorPairs, edges: edges as Edge[] };
  }

  return { anchorPairs, edges: resolvedEdges };
}
