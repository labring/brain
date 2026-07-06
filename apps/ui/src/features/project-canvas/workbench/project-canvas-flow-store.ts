import { mergeNodes } from "@workspace/ui/components/canvas/canvas.node-merge";
import type {
  CanvasFlowSnapshot,
  CanvasFlowStore,
} from "@workspace/ui/components/canvas/canvas.types";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";

export interface ProjectCanvasFlowStore extends CanvasFlowStore {
  /**
   * Reconciles graph-derived nodes/edges into the flow snapshot. Node data
   * always wins from the incoming graph while in-session positions (drags)
   * and expansion survive, matching the previous canvas mirror-merge
   * semantics. Node reconciliation is deferred while a drag is in flight and
   * applied when the drag ends.
   */
  reconcile(input: { edges: Edge[]; nodes: Node[] }): void;
  setSelectedEdgeId(selectedEdgeId: string | null): void;
}

function edgesMatchIncoming(current: Edge[], incoming: Edge[]): boolean {
  if (current.length !== incoming.length) {
    return false;
  }

  return incoming.every((edge, index) => {
    const existing = current[index];
    if (existing === undefined) {
      return false;
    }

    return (Object.keys(edge) as Array<keyof Edge>).every((key) =>
      Object.is(existing[key], edge[key])
    );
  });
}

function someDragging(nodes: readonly Node[]): boolean {
  return nodes.some((node) => node.dragging === true);
}

/**
 * Canvas Runtime presentation store for the React Flow view: holds the
 * rendered node/edge arrays (positions, zIndex, expansion, drag state) and is
 * the single writer React Flow changes go through. The flow view subscribes;
 * the canvas controller only writes.
 */
export function createProjectCanvasFlowStore(): ProjectCanvasFlowStore {
  let snapshot: CanvasFlowSnapshot = {
    edges: [],
    nodes: [],
    selectedEdgeId: null,
  };
  let incomingNodes: Node[] = [];
  const listeners = new Set<() => void>();

  const commit = (
    nodes: Node[],
    edges: Edge[],
    selectedEdgeId: string | null = snapshot.selectedEdgeId ?? null
  ) => {
    if (
      nodes === snapshot.nodes &&
      edges === snapshot.edges &&
      selectedEdgeId === snapshot.selectedEdgeId
    ) {
      return;
    }
    snapshot = { edges, nodes, selectedEdgeId };
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    applyEdgeChanges(changes: EdgeChange[]) {
      commit(snapshot.nodes, applyEdgeChanges(changes, snapshot.edges));
    },
    applyNodeChanges(changes: NodeChange[]) {
      const current = snapshot.nodes;
      const applied = applyNodeChanges(changes, current);
      const dragEnded = someDragging(current) && !someDragging(applied);
      const next = dragEnded ? mergeNodes(applied, incomingNodes) : applied;
      commit(next, snapshot.edges);
    },
    getSnapshot() {
      return snapshot;
    },
    reconcile({ edges, nodes }) {
      incomingNodes = nodes;
      const nextEdges = edgesMatchIncoming(snapshot.edges, edges)
        ? snapshot.edges
        : edges;
      const nextNodes = someDragging(snapshot.nodes)
        ? snapshot.nodes
        : mergeNodes(snapshot.nodes, incomingNodes);
      commit(nextNodes, nextEdges);
    },
    setSelectedEdgeId(selectedEdgeId) {
      commit(snapshot.nodes, snapshot.edges, selectedEdgeId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
