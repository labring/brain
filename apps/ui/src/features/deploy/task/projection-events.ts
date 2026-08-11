import "server-only";

import { getDeployTaskEngineContext } from "./engine/server";
import type {
  DeploymentTaskProjection,
  DeploymentTaskProjectionStreamEvent,
} from "./projection";
import { toDeploymentTaskProjection } from "./projection";
import { getDeployTaskById } from "./service";

type DeploymentTaskProjectionListener = (
  event: DeploymentTaskProjectionStreamEvent
) => void;

/**
 * Project-scoped projection events, driven by the global NOTIFY channel
 * (ADR 0037): payloads carry ids only, so each event re-reads the row —
 * serialized per task so deliveries stay monotonic; a transport reset
 * re-reads the whole project because
 * notifications during the gap are lost, holding per-task deliveries back
 * until its snapshot lands so the snapshot never erases a newer delivery.
 */
export interface DeploymentTaskEventsSubscription {
  /**
   * Resolves once LISTEN is established; reads before this can miss events.
   * Rejects when LISTEN cannot be established — callers must fail their
   * stream instead of serving a snapshot that will never receive updates.
   */
  ready: Promise<void>;
  unsubscribe: () => void;
}

export function subscribeDeploymentTaskProjectionEvents(input: {
  listProjections: () => Promise<DeploymentTaskProjection[]>;
  listener: DeploymentTaskProjectionListener;
  namespace: string;
  projectId: string;
}): DeploymentTaskEventsSubscription {
  const ctx = getDeployTaskEngineContext();
  let cancelled = false;
  let unsubscribe: (() => void | Promise<void>) | null = null;

  // Single-flight per task with a trailing re-read (same discipline as
  // timeline-events, but keyed by taskId because this channel is
  // project-scoped): concurrent re-reads can resolve out of order and
  // deliver an older row state after a newer one; the trailing read folds
  // every notification that arrived mid-read into one final delivery.
  const inflightReads = new Map<string, { queued: boolean }>();

  // Reset snapshots replace the listener's whole set, so a snapshot must
  // never land after a per-task delivery it does not contain — the replace
  // would drop that task. While a reset re-read is in flight, per-task
  // deliveries are buffered and replayed after the snapshot; overlapping
  // resets keep only the newest read (older resolutions are discarded).
  let resetGeneration = 0;
  let bufferedDuringReset: DeploymentTaskProjectionStreamEvent[] | null = null;

  const deliver = (event: DeploymentTaskProjectionStreamEvent) => {
    if (bufferedDuringReset != null) {
      bufferedDuringReset.push(event);
      return;
    }
    input.listener(event);
  };

  const flushBufferedDuringReset = () => {
    const buffered = bufferedDuringReset ?? [];
    bufferedDuringReset = null;
    for (const event of buffered) {
      if (cancelled) {
        return;
      }
      input.listener(event);
    }
  };

  const emitTask = (taskId: string) => {
    const inflight = inflightReads.get(taskId);
    if (inflight != null) {
      inflight.queued = true;
      return;
    }
    const slot = { queued: false };
    inflightReads.set(taskId, slot);
    getDeployTaskById(taskId)
      .then((row) => {
        if (cancelled || row == null || row.namespace !== input.namespace) {
          return;
        }
        const rowProjectId = row.projectId?.trim() ?? "";
        if (rowProjectId !== input.projectId) {
          return;
        }
        const projection = toDeploymentTaskProjection(row);
        if (projection == null) {
          deliver({
            namespace: row.namespace,
            projectId: input.projectId,
            taskId: row.id,
            type: "remove",
          });
          return;
        }
        deliver({ projection, type: "upsert" });
      })
      .catch((error) => {
        console.error("[deploy-task-projection-events] re-read failed:", error);
      })
      .finally(() => {
        inflightReads.delete(taskId);
        if (slot.queued && !cancelled) {
          emitTask(taskId);
        }
      });
  };

  const ready = ctx.notify
    .subscribe((event) => {
      if (cancelled) {
        return;
      }
      if (event.kind === "reset") {
        const generation = ++resetGeneration;
        bufferedDuringReset ??= [];
        input
          .listProjections()
          .then((projections) => {
            if (cancelled || generation !== resetGeneration) {
              return;
            }
            input.listener({ projections, type: "snapshot" });
            flushBufferedDuringReset();
          })
          .catch((error) => {
            console.error(
              "[deploy-task-projection-events] reset re-read failed:",
              error
            );
            // No snapshot is coming for this reset: reopen the delta flow
            // so buffered deliveries are not stuck behind it.
            if (!cancelled && generation === resetGeneration) {
              flushBufferedDuringReset();
            }
          });
        return;
      }
      if (event.namespace !== input.namespace) {
        return;
      }
      emitTask(event.taskId);
    })
    .then((unsub) => {
      if (cancelled) {
        unsub()?.catch?.(() => undefined);
        return;
      }
      unsubscribe = unsub;
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
