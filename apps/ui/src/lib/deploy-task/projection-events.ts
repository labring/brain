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
 * (ADR 0037): payloads carry ids only, so each event re-reads the row; a
 * purge notification is itself the removal; a transport reset re-reads the
 * whole project because notifications during the gap are lost.
 */
export function subscribeDeploymentTaskProjectionEvents(input: {
  listProjections: () => Promise<DeploymentTaskProjection[]>;
  listener: DeploymentTaskProjectionListener;
  namespace: string;
  projectId: string;
}): () => void {
  const ctx = getDeployTaskEngineContext();
  let cancelled = false;
  let unsubscribe: (() => void | Promise<void>) | null = null;

  ctx.notify
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
      getDeployTaskById(event.taskId)
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
          console.error(
            "[deploy-task-projection-events] re-read failed:",
            error
          );
        });
    })
    .then((unsub) => {
      if (cancelled) {
        unsub()?.catch?.(() => undefined);
        return;
      }
      unsubscribe = unsub;
    })
    .catch((error) => {
      console.error("[deploy-task-projection-events] subscribe failed:", error);
    });

  return () => {
    cancelled = true;
    if (unsubscribe != null) {
      unsubscribe()?.catch?.(() => undefined);
    }
  };
}
