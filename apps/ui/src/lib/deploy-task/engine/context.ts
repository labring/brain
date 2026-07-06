import type { DeploymentTaskPgDatabase } from "../db-types";
import type { DeployTaskEngineCadence } from "./constants";
import type { DeployTaskNotifyTransport } from "./notify";

/**
 * The one integration the engine itself drives: devbox pause/delete run under
 * the server-minted namespace JWT, so the reaper can settle terminal tasks
 * whose owning process died (ADR 0037/0038). Every other integration is
 * runner territory and rides the request-scoped kubeconfig.
 */
export interface DeployTaskEngineDevbox {
  deleteDevbox: (
    namespace: string,
    name: string
  ) => Promise<"deleted" | "missing">;
  pauseDevbox: (
    namespace: string,
    name: string
  ) => Promise<"missing" | "paused">;
}

export interface DeployTaskEngineContext {
  cadence: DeployTaskEngineCadence;
  db: DeploymentTaskPgDatabase;
  devbox: DeployTaskEngineDevbox;
  notify: DeployTaskNotifyTransport;
  processId: string;
}
