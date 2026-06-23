import type { CanvasNodeConnectionSide } from "@workspace/ui/components/canvas-node/canvas-node";
import type { Edge } from "@xyflow/react";

export interface ProjectCanvasInteractionSnapshot {
  connectionOrigin?: {
    nodeId: string;
    side: CanvasNodeConnectionSide;
  } | null;
  selectedEdge?: Pick<Edge, "source" | "target"> | null;
  selectedNodeId?: string | null;
}

export interface ProjectCanvasNodeInteraction {
  highlightedConnectionSide?: CanvasNodeConnectionSide;
  selected: boolean;
}

export interface ProjectCanvasInteractionStore {
  getNodeInteraction(nodeId: string): ProjectCanvasNodeInteraction;
  setSnapshot(snapshot: ProjectCanvasInteractionSnapshot): void;
  subscribeNode(nodeId: string, listener: () => void): () => void;
}

const EMPTY_INTERACTION: ProjectCanvasNodeInteraction = { selected: false };

function nodeIdsFromSnapshot(
  snapshot: ProjectCanvasInteractionSnapshot
): Set<string> {
  const ids = new Set<string>();
  if (snapshot.selectedNodeId != null && snapshot.selectedNodeId !== "") {
    ids.add(snapshot.selectedNodeId);
  }
  if (snapshot.selectedEdge != null) {
    ids.add(snapshot.selectedEdge.source);
    ids.add(snapshot.selectedEdge.target);
  }
  if (snapshot.connectionOrigin != null) {
    ids.add(snapshot.connectionOrigin.nodeId);
  }
  return ids;
}

function interactionsEqual(
  a: ProjectCanvasNodeInteraction,
  b: ProjectCanvasNodeInteraction
): boolean {
  return (
    a.selected === b.selected &&
    a.highlightedConnectionSide === b.highlightedConnectionSide
  );
}

export function selectProjectCanvasNodeInteraction(
  snapshot: ProjectCanvasInteractionSnapshot,
  nodeId: string
): ProjectCanvasNodeInteraction {
  const selectedByNode = snapshot.selectedNodeId === nodeId;
  const selectedByEdge =
    snapshot.selectedEdge?.source === nodeId ||
    snapshot.selectedEdge?.target === nodeId;
  const highlightedConnectionSide =
    snapshot.connectionOrigin?.nodeId === nodeId
      ? snapshot.connectionOrigin.side
      : undefined;

  if (
    !(selectedByNode || selectedByEdge) &&
    highlightedConnectionSide == null
  ) {
    return EMPTY_INTERACTION;
  }
  return {
    ...(highlightedConnectionSide == null ? {} : { highlightedConnectionSide }),
    selected: selectedByNode || selectedByEdge,
  };
}

export function projectCanvasInteractionAffectedNodeIds(
  before: ProjectCanvasInteractionSnapshot,
  after: ProjectCanvasInteractionSnapshot
): Set<string> {
  const candidates = new Set([
    ...nodeIdsFromSnapshot(before),
    ...nodeIdsFromSnapshot(after),
  ]);
  const affected = new Set<string>();
  for (const nodeId of candidates) {
    if (
      !interactionsEqual(
        selectProjectCanvasNodeInteraction(before, nodeId),
        selectProjectCanvasNodeInteraction(after, nodeId)
      )
    ) {
      affected.add(nodeId);
    }
  }
  return affected;
}

export function createProjectCanvasInteractionStore(
  initialSnapshot: ProjectCanvasInteractionSnapshot = {}
): ProjectCanvasInteractionStore {
  let snapshot = initialSnapshot;
  const subscribersByNodeId = new Map<string, Set<() => void>>();
  const nodeInteractionById = new Map<string, ProjectCanvasNodeInteraction>();

  return {
    getNodeInteraction(nodeId) {
      const cached = nodeInteractionById.get(nodeId);
      if (cached !== undefined) {
        return cached;
      }
      const interaction = selectProjectCanvasNodeInteraction(snapshot, nodeId);
      nodeInteractionById.set(nodeId, interaction);
      return interaction;
    },
    setSnapshot(nextSnapshot) {
      const affectedNodeIds = projectCanvasInteractionAffectedNodeIds(
        snapshot,
        nextSnapshot
      );
      snapshot = nextSnapshot;
      for (const nodeId of affectedNodeIds) {
        const previous = nodeInteractionById.get(nodeId);
        const next = selectProjectCanvasNodeInteraction(snapshot, nodeId);
        if (previous !== undefined && interactionsEqual(previous, next)) {
          continue;
        }
        nodeInteractionById.set(nodeId, next);
        for (const subscriber of subscribersByNodeId.get(nodeId) ?? []) {
          subscriber();
        }
      }
    },
    subscribeNode(nodeId, listener) {
      const subscribers = subscribersByNodeId.get(nodeId) ?? new Set();
      subscribers.add(listener);
      subscribersByNodeId.set(nodeId, subscribers);
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) {
          subscribersByNodeId.delete(nodeId);
          nodeInteractionById.delete(nodeId);
        }
      };
    },
  };
}
