import {
  CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
  resolveMissingResourceLayoutGrace,
} from "../layout/missing-resource-grace";
import type {
  CanvasLayoutDocument,
  CanvasLayoutResourceRef,
  PlacementCommand,
} from "../layout/types";

/** Slack added to grace-expiry timers so the deadline is safely past. */
const GRACE_TIMER_SLACK_MS = 25;

export interface MissingResourceGraceSnapshot {
  deleteCommands: PlacementCommand[];
  /**
   * Clock sample the grace resolution ran against. `0` until the first
   * commit — safe because the resource topology is empty until that same
   * commit, so no node ever renders against the epoch sample.
   */
  nowMs: number;
  retainedLayoutOwnerKeys: ReadonlySet<string>;
}

export interface MissingResourceGraceStoreCommit {
  layout: CanvasLayoutDocument | undefined;
  /**
   * False while lists are loading, erroring, or the layout has not settled.
   * A not-ready commit publishes an empty grace result but keeps the
   * missing-since accumulator so an in-flight grace window survives a
   * transient reload.
   */
  ready: boolean;
  resourceIdentities: readonly CanvasLayoutResourceRef[];
}

/**
 * Owns the missing-resource layout grace accumulator for one project canvas:
 * which layout owners lost their runtime resource, when they first went
 * missing, and which of them are still inside the retention grace window.
 *
 * The store samples the clock and mutates the accumulator only inside
 * `commit` (called from an effect) and its self-scheduled expiry timer, so
 * renders can consume the result through `useSyncExternalStore` without
 * touching `Date.now()` or mutable state.
 */
export interface MissingResourceGraceStore {
  commit(input: MissingResourceGraceStoreCommit): void;
  dispose(): void;
  getSnapshot(): MissingResourceGraceSnapshot;
  subscribe(listener: () => void): () => void;
}

function nextMissingResourceGraceDelayMs(
  missingSinceByOwnerKey: ReadonlyMap<string, number>,
  retainedOwnerKeys: ReadonlySet<string>,
  nowMs: number
): number | undefined {
  let nextDelay: number | undefined;
  for (const ownerKey of retainedOwnerKeys) {
    const firstMissingAt = missingSinceByOwnerKey.get(ownerKey);
    if (firstMissingAt === undefined) {
      continue;
    }
    const delay = Math.max(
      0,
      firstMissingAt + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS - nowMs
    );
    nextDelay = nextDelay === undefined ? delay : Math.min(nextDelay, delay);
  }
  return nextDelay;
}

export function createMissingResourceGraceStore(): MissingResourceGraceStore {
  let missingSinceByOwnerKey: ReadonlyMap<string, number> = new Map();
  let snapshot: MissingResourceGraceSnapshot = {
    deleteCommands: [],
    nowMs: 0,
    retainedLayoutOwnerKeys: new Set(),
  };
  let lastReadyInput: Omit<MissingResourceGraceStoreCommit, "ready"> | null =
    null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  function clearExpiryTimer(): void {
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  }

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function resolve(): void {
    if (lastReadyInput === null) {
      return;
    }
    const nowMs = Date.now();
    const result = resolveMissingResourceLayoutGrace({
      layout: lastReadyInput.layout,
      nowMs,
      previousMissingSinceByOwnerKey: missingSinceByOwnerKey,
      resourceIdentities: lastReadyInput.resourceIdentities,
    });
    missingSinceByOwnerKey = result.nextMissingSinceByOwnerKey;
    snapshot = {
      deleteCommands: result.deleteCommands,
      nowMs,
      retainedLayoutOwnerKeys: result.retainedLayoutOwnerKeys,
    };
    clearExpiryTimer();
    const nextDelay = nextMissingResourceGraceDelayMs(
      missingSinceByOwnerKey,
      result.retainedLayoutOwnerKeys,
      nowMs
    );
    if (nextDelay !== undefined) {
      expiryTimer = setTimeout(() => {
        expiryTimer = null;
        resolve();
        notify();
      }, nextDelay + GRACE_TIMER_SLACK_MS);
    }
  }

  return {
    commit(input) {
      if (!input.ready) {
        lastReadyInput = null;
        clearExpiryTimer();
        if (
          snapshot.deleteCommands.length > 0 ||
          snapshot.retainedLayoutOwnerKeys.size > 0
        ) {
          snapshot = {
            deleteCommands: [],
            nowMs: snapshot.nowMs,
            retainedLayoutOwnerKeys: new Set(),
          };
          notify();
        }
        return;
      }
      lastReadyInput = {
        layout: input.layout,
        resourceIdentities: input.resourceIdentities,
      };
      resolve();
      notify();
    },
    dispose() {
      clearExpiryTimer();
      listeners.clear();
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
