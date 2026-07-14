import "server-only";

import { getDeployTaskEngineContext } from "./engine/server";
import { getDeployTaskTimelineSnapshot } from "./service";
import type { DeploymentTaskTimelineSnapshotDTO } from "./types";

type DeploymentTaskTimelineListener = (
  snapshot: DeploymentTaskTimelineSnapshotDTO
) => void;

/**
 * Per-task timeline updates, driven by the global NOTIFY channel (ADR 0037):
 * each matching event re-reads the timeline snapshot; a transport reset
 * re-reads unconditionally because notifications during the gap are lost.
 */
export interface DeploymentTaskTimelineSubscription {
  /** Resolves once LISTEN is established; reads before this can miss events. */
  ready: Promise<void>;
  unsubscribe: () => void;
}

export function subscribeDeploymentTaskTimelineEvents(input: {
  listener: DeploymentTaskTimelineListener;
  namespace: string;
  taskId: string;
}): DeploymentTaskTimelineSubscription {
  const ctx = getDeployTaskEngineContext();
  let cancelled = false;
  let unsubscribe: (() => void | Promise<void>) | null = null;
  let emitting = false;
  let emitQueued = false;

  // Single-flight with a trailing re-read: concurrent re-reads can resolve
  // out of order and deliver an older row state after a newer one; the
  // trailing read folds every notification that arrived mid-read into one
  // final snapshot, so the last delivery always reflects the last write.
  const emitCurrent = () => {
    if (emitting) {
      emitQueued = true;
      return;
    }
    emitting = true;
    getDeployTaskTimelineSnapshot(input.taskId, input.namespace)
      .then((snapshot) => {
        if (!cancelled && snapshot != null) {
          input.listener(snapshot);
        }
      })
      .catch((error) => {
        console.error("[deploy-task-timeline-events] re-read failed:", error);
      })
      .finally(() => {
        emitting = false;
        if (emitQueued && !cancelled) {
          emitQueued = false;
          emitCurrent();
        }
      });
  };

  const ready = ctx.notify
    .subscribe((event) => {
      if (cancelled) {
        return;
      }
      if (event.kind === "reset") {
        emitCurrent();
        return;
      }
      if (event.taskId !== input.taskId || event.kind === "purge") {
        return;
      }
      emitCurrent();
    })
    .then((unsub) => {
      if (cancelled) {
        unsub()?.catch?.(() => undefined);
        return;
      }
      unsubscribe = unsub;
    })
    .catch((error) => {
      console.error("[deploy-task-timeline-events] subscribe failed:", error);
    });

  return {
    ready,
    unsubscribe: () => {
      cancelled = true;
      if (unsubscribe != null) {
        unsubscribe()?.catch?.(() => undefined);
      }
    },
  };
}
