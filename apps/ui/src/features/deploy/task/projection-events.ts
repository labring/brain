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
 * serialized per task so deliveries stay monotonic; a purge notification is
 * itself the removal; a transport reset re-reads the whole project because
 * notifications during the gap are lost.
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
  // Purged ids are tombstoned so a re-read racing the purge cannot
  // resurrect the task — task ids are never reused.
  const inflightReads = new Map<string, { queued: boolean }>();
  const purgedTaskIds = new Set<string>();

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
        if (
          cancelled ||
          purgedTaskIds.has(taskId) ||
          row == null ||
          row.namespace !== input.namespace
        ) {
          return;
        }
        const rowProjectId = row.projectId?.trim() ?? "";
        if (rowProjectId !== input.projectId) {
          return;
        }
        const projection = toDeploymentTaskProjection(row);
        if (projection == null) {
          input.listener({
            namespace: row.namespace,
            projectId: input.projectId,
            taskId: row.id,
            type: "remove",
          });
          return;
        }
        input.listener({ projection, type: "upsert" });
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
        input
          .listProjections()
          .then((projections) => {
            if (!cancelled) {
              input.listener({ projections, type: "snapshot" });
            }
          })
          .catch((error) => {
            console.error(
              "[deploy-task-projection-events] reset re-read failed:",
              error
            );
          });
        return;
      }
      if (event.namespace !== input.namespace) {
        return;
      }
      if (event.kind === "purge") {
        purgedTaskIds.add(event.taskId);
        const inflight = inflightReads.get(event.taskId);
        if (inflight != null) {
          inflight.queued = false;
        }
        if (event.projectId === input.projectId) {
          input.listener({
            namespace: event.namespace,
            projectId: input.projectId,
            taskId: event.taskId,
            type: "remove",
          });
        }
        return;
      }
      if (purgedTaskIds.has(event.taskId)) {
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
