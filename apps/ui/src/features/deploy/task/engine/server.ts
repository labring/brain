import "server-only";

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";

import { DevboxApiError, deleteDevbox, pauseDevbox } from "@/lib/devbox/client";

import { getDeploymentTaskDb } from "../db";
import { DEPLOY_TASK_ENGINE_CADENCE } from "./constants";
import type {
  DeployTaskEngineContext,
  DeployTaskEngineDevbox,
} from "./context";
import { getDeployTaskNotifyTransport } from "./notify-server";
import { startDeployTaskEngineRuntime } from "./runtime";

const DEVBOX_REAPER_OPERATION_TIMEOUT_MS = 10_000;

function isMissingDevboxError(error: unknown): boolean {
  return error instanceof DevboxApiError && error.status === 404;
}

const serverDevbox: DeployTaskEngineDevbox = {
  async deleteDevbox(namespace, name) {
    try {
      await deleteDevbox(namespace, name);
      return "deleted";
    } catch (error) {
      if (isMissingDevboxError(error)) {
        return "missing";
      }
      throw error;
    }
  },
  async pauseDevbox(namespace, name) {
    try {
      await pauseDevbox(
        namespace,
        name,
        AbortSignal.timeout(DEVBOX_REAPER_OPERATION_TIMEOUT_MS)
      );
      return "paused";
    } catch (error) {
      if (isMissingDevboxError(error)) {
        return "missing";
      }
      throw error;
    }
  },
};

const globalContext = globalThis as unknown as {
  __sealaiDeployTaskEngineContext?: DeployTaskEngineContext;
};

export function getDeployTaskEngineContext(): DeployTaskEngineContext {
  globalContext.__sealaiDeployTaskEngineContext ??= {
    cadence: DEPLOY_TASK_ENGINE_CADENCE,
    db: getDeploymentTaskDb(),
    devbox: serverDevbox,
    notify: getDeployTaskNotifyTransport(),
    processId: `${hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
  };
  return globalContext.__sealaiDeployTaskEngineContext;
}

/**
 * Boot hook (called from instrumentation after migrations): starts the
 * reaper and shutdown drain for this process.
 */
export function startDeployTaskEngine(): void {
  startDeployTaskEngineRuntime(getDeployTaskEngineContext());
}
