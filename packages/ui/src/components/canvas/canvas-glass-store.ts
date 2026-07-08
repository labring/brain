/**
 * Per-node subscription store for the masked glass sheet (AIM-17). The sheet
 * controller writes one snapshot per animation frame; each node surface
 * subscribes by id and re-renders only when its own self-blur decision flips.
 * Mirrors the interaction-store pattern so facts flow through a store, never
 * through node data or per-frame className churn (ADR-0035).
 */

export interface CanvasGlassSnapshot {
  /** True while a shared sheet is mounted and handling isolated nodes. */
  active: boolean;
  /** Ids of nodes that currently overlap another node. */
  overlapping: ReadonlySet<string>;
}

export interface CanvasGlassStore {
  getNodeSelfBlur(nodeId: string): boolean;
  setSnapshot(snapshot: CanvasGlassSnapshot): void;
  subscribeNode(nodeId: string, listener: () => void): () => void;
}

const INACTIVE_SNAPSHOT: CanvasGlassSnapshot = {
  active: false,
  overlapping: new Set(),
};

/**
 * A node paints its own backdrop-filter when there is no active sheet, or when
 * it overlaps another node (the shared sheet can't blur one node behind
 * another). Otherwise the sheet blurs under it and the node drops its own blur.
 */
export function selectCanvasNodeSelfBlur(
  snapshot: CanvasGlassSnapshot,
  nodeId: string
): boolean {
  return !snapshot.active || snapshot.overlapping.has(nodeId);
}

/**
 * Ids whose self-blur decision differs between two snapshots. Overlap
 * membership changes touch the nodes entering/leaving overlap; an `active` flip
 * can change every tracked node, so those are all candidates.
 */
function canvasGlassAffectedNodeIds(
  before: CanvasGlassSnapshot,
  after: CanvasGlassSnapshot,
  tracked: Iterable<string>
): Set<string> {
  const candidates = new Set<string>();
  for (const id of before.overlapping) {
    candidates.add(id);
  }
  for (const id of after.overlapping) {
    candidates.add(id);
  }
  if (before.active !== after.active) {
    for (const id of tracked) {
      candidates.add(id);
    }
  }
  const affected = new Set<string>();
  for (const id of candidates) {
    if (
      selectCanvasNodeSelfBlur(before, id) !==
      selectCanvasNodeSelfBlur(after, id)
    ) {
      affected.add(id);
    }
  }
  return affected;
}

export function createCanvasGlassStore(
  initialSnapshot: CanvasGlassSnapshot = INACTIVE_SNAPSHOT
): CanvasGlassStore {
  let snapshot = initialSnapshot;
  const subscribersByNodeId = new Map<string, Set<() => void>>();
  const selfBlurByNodeId = new Map<string, boolean>();

  return {
    getNodeSelfBlur(nodeId) {
      const cached = selfBlurByNodeId.get(nodeId);
      if (cached !== undefined) {
        return cached;
      }
      const selfBlur = selectCanvasNodeSelfBlur(snapshot, nodeId);
      selfBlurByNodeId.set(nodeId, selfBlur);
      return selfBlur;
    },
    setSnapshot(nextSnapshot) {
      const affectedNodeIds = canvasGlassAffectedNodeIds(
        snapshot,
        nextSnapshot,
        selfBlurByNodeId.keys()
      );
      snapshot = nextSnapshot;
      for (const nodeId of affectedNodeIds) {
        const selfBlur = selectCanvasNodeSelfBlur(snapshot, nodeId);
        if (selfBlurByNodeId.get(nodeId) === selfBlur) {
          continue;
        }
        selfBlurByNodeId.set(nodeId, selfBlur);
        for (const listener of subscribersByNodeId.get(nodeId) ?? []) {
          listener();
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
          selfBlurByNodeId.delete(nodeId);
        }
      };
    },
  };
}
