import { deploymentFailureMessage } from "../failure-summary";
import type { DeployTaskEngineContext } from "./context";
import {
  DeployTaskRunCancelledError,
  DeployTaskRunSupersededError,
  DeployTaskRunTimeoutError,
  isDeployTaskAbortError,
} from "./errors";
import { createDeployTaskHandle, type DeployTaskHandle } from "./handle";
import { runDeployTaskReaperSweep } from "./reaper";
import {
  DEPLOY_TASK_LEASED_STATUSES,
  type DeployTaskRowLite,
  renewDeployTaskLease,
  transitionDeployTask,
} from "./transitions";

class DeployTaskShutdownError extends Error {
  constructor() {
    super("Server is shutting down.");
    this.name = "DeployTaskShutdownError";
  }
}

interface DeployTaskActiveRun {
  controller: AbortController;
  deadlineTimer: ReturnType<typeof setTimeout>;
  handle: DeployTaskHandle | null;
  leaseEpoch: number;
  renewTimer: ReturnType<typeof setInterval>;
  taskId: string;
}

interface DeployTaskEngineRuntime {
  activeRuns: Map<string, DeployTaskActiveRun>;
  reaperBusy: boolean;
  reaperTimer: ReturnType<typeof setInterval> | null;
  shuttingDown: boolean;
  signalHandlersInstalled: boolean;
}

const globalRuntime = globalThis as unknown as {
  __sealaiDeployTaskEngineRuntime?: DeployTaskEngineRuntime;
};

function getRuntime(): DeployTaskEngineRuntime {
  globalRuntime.__sealaiDeployTaskEngineRuntime ??= {
    activeRuns: new Map(),
    reaperBusy: false,
    reaperTimer: null,
    shuttingDown: false,
    signalHandlersInstalled: false,
  };
  return globalRuntime.__sealaiDeployTaskEngineRuntime;
}

function unregisterRun(
  runtime: DeployTaskEngineRuntime,
  expectedRun: DeployTaskActiveRun
): void {
  if (runtime.activeRuns.get(expectedRun.taskId) !== expectedRun) {
    return;
  }
  clearTimeout(expectedRun.deadlineTimer);
  clearInterval(expectedRun.renewTimer);
  runtime.activeRuns.delete(expectedRun.taskId);
}

/**
 * Resolve this process's own leases honestly on shutdown instead of leaving
 * zombies for another process's reaper (ADR 0037). Best-effort: the writes
 * race the host's exit; anything unfinished is reaped via lease expiry.
 */
async function drainForShutdown(
  ctx: DeployTaskEngineContext,
  runtime: DeployTaskEngineRuntime
): Promise<void> {
  if (runtime.shuttingDown) {
    return;
  }
  runtime.shuttingDown = true;
  if (runtime.reaperTimer != null) {
    clearInterval(runtime.reaperTimer);
    runtime.reaperTimer = null;
  }
  const runs = [...runtime.activeRuns.values()];
  const interruptedMessage = deploymentFailureMessage("interrupted");
  await Promise.all(
    runs.map(async (run) => {
      run.controller.abort(new DeployTaskShutdownError());
      try {
        await transitionDeployTask(ctx, {
          event: {
            kind: "deployment_task.engine_resolved",
            message: interruptedMessage,
            payload: { reason: "interrupted", verdict: "failed" },
          },
          expectedLeaseEpoch: run.leaseEpoch,
          from: DEPLOY_TASK_LEASED_STATUSES,
          set: {
            error: interruptedMessage,
            failureDetails: {
              detail: "shutdown",
              failureMessage: interruptedMessage,
              reason: "interrupted",
            },
          },
          taskId: run.taskId,
          to: "failed",
        });
      } catch (error) {
        console.error(
          `[deploy-task-engine] shutdown drain failed for ${run.taskId}:`,
          error
        );
      } finally {
        unregisterRun(runtime, run);
      }
    })
  );
}

function installSignalHandlers(
  ctx: DeployTaskEngineContext,
  runtime: DeployTaskEngineRuntime
): void {
  if (runtime.signalHandlersInstalled) {
    return;
  }
  runtime.signalHandlersInstalled = true;
  const drain = () => {
    drainForShutdown(ctx, runtime).catch((error) => {
      console.error("[deploy-task-engine] shutdown drain error:", error);
    });
  };
  process.once("SIGTERM", drain);
  process.once("SIGINT", drain);
}

/**
 * Starts the per-process engine runtime: the reaper interval plus shutdown
 * drain hooks. Idempotent and HMR-safe via a globalThis singleton.
 */
export function startDeployTaskEngineRuntime(
  ctx: DeployTaskEngineContext
): void {
  const runtime = getRuntime();
  installSignalHandlers(ctx, runtime);
  if (runtime.reaperTimer != null || runtime.shuttingDown) {
    return;
  }
  const sweep = () => {
    if (runtime.reaperBusy) {
      return;
    }
    runtime.reaperBusy = true;
    runDeployTaskReaperSweep(ctx)
      .catch((error) => {
        console.error("[deploy-task-engine] reaper sweep failed:", error);
      })
      .finally(() => {
        runtime.reaperBusy = false;
      });
  };
  runtime.reaperTimer = setInterval(sweep, ctx.cadence.reaperIntervalMs);
  // Resolve pre-restart zombies promptly rather than waiting a full interval.
  sweep();
}

/**
 * The current in-process execution's handle for a task, if any. Runner-side
 * write shims resolve their fenced handle here; a superseded or finished run
 * finds nothing and its writes fail closed (ADR 0037).
 */
export function getActiveDeployTaskHandle(
  taskId: string
): DeployTaskHandle | null {
  const runtime = globalRuntime.__sealaiDeployTaskEngineRuntime;
  return runtime?.activeRuns.get(taskId)?.handle ?? null;
}

/**
 * Fast-path cancel delivery when the run executes in this process: the
 * abort signal fires immediately instead of waiting for the renewal poll.
 */
export function abortLocalRunForCancel(taskId: string): boolean {
  const runtime = globalRuntime.__sealaiDeployTaskEngineRuntime;
  const run = runtime?.activeRuns.get(taskId);
  if (run == null) {
    return false;
  }
  if (!run.controller.signal.aborted) {
    run.controller.abort(new DeployTaskRunCancelledError());
  }
  return true;
}

export function stopDeployTaskEngineRuntimeForTests(): void {
  const runtime = globalRuntime.__sealaiDeployTaskEngineRuntime;
  if (runtime == null) {
    return;
  }
  if (runtime.reaperTimer != null) {
    clearInterval(runtime.reaperTimer);
  }
  for (const run of runtime.activeRuns.values()) {
    clearTimeout(run.deadlineTimer);
    clearInterval(run.renewTimer);
  }
  globalRuntime.__sealaiDeployTaskEngineRuntime = undefined;
}

export interface LaunchDeployTaskRunInput {
  claim: DeployTaskRowLite;
  run: (handle: DeployTaskHandle) => Promise<void>;
}

export interface LaunchedDeployTaskRun {
  /** Settles when the run has fully unwound (including outcome fallbacks). */
  done: Promise<void>;
  handle: DeployTaskHandle;
}

/**
 * Runs a claimed task under its lease: fenced timer renewal (doubling as the
 * cancel-intent poll), the runner confined to the task handle, and outcome
 * fallbacks that make cancellation a typed outcome — an aborted run resolves
 * to cancelled, never to failed, and never enters failure cleanup.
 */
export function launchDeployTaskRun(
  ctx: DeployTaskEngineContext,
  input: LaunchDeployTaskRunInput
): LaunchedDeployTaskRun {
  const runtime = getRuntime();
  const controller = new AbortController();
  let activeRun: DeployTaskActiveRun | null = null;
  let deadlineResolution: Promise<void> | null = null;
  const unregisterActiveRun = () => {
    if (activeRun != null) {
      unregisterRun(runtime, activeRun);
    }
  };
  if (runtime.shuttingDown) {
    controller.abort(new DeployTaskShutdownError());
  }

  const handle = createDeployTaskHandle(ctx, {
    controller,
    leaseEpoch: input.claim.leaseEpoch,
    namespace: input.claim.namespace,
    onEnded: unregisterActiveRun,
    taskId: input.claim.taskId,
  });

  const renewTimer = setInterval(() => {
    (async () => {
      const renewed = await renewDeployTaskLease(ctx, {
        expectedLeaseEpoch: input.claim.leaseEpoch,
        taskId: input.claim.taskId,
      });
      if (renewed == null) {
        if (!controller.signal.aborted) {
          controller.abort(new DeployTaskRunSupersededError());
        }
        unregisterActiveRun();
        return;
      }
      if (renewed.cancelRequestedAt != null && !controller.signal.aborted) {
        controller.abort(new DeployTaskRunCancelledError());
      }
    })().catch((error) => {
      console.error(
        `[deploy-task-engine] lease renewal failed for ${input.claim.taskId}:`,
        error
      );
    });
  }, ctx.cadence.leaseRenewIntervalMs);

  const deadlineTimer = setTimeout(() => {
    const timeoutMessage = deploymentFailureMessage("timeout");
    // Stop local side effects before touching the database. Removing the
    // active handle also makes runner-write shims fail closed while the
    // terminal transition is slow or temporarily unavailable.
    if (!controller.signal.aborted) {
      controller.abort(new DeployTaskRunTimeoutError());
    }
    unregisterActiveRun();

    deadlineResolution = (async () => {
      const timedOut = await transitionDeployTask(ctx, {
        cancelRequest: "absent",
        event: {
          kind: "deployment_task.engine_resolved",
          message: timeoutMessage,
          payload: { reason: "timeout", verdict: "failed" },
        },
        expectedLeaseEpoch: input.claim.leaseEpoch,
        from: DEPLOY_TASK_LEASED_STATUSES,
        set: {
          error: timeoutMessage,
          failureDetails: {
            failureMessage: timeoutMessage,
            reason: "timeout",
          },
        },
        taskId: input.claim.taskId,
        to: "failed",
      });
      if (timedOut != null) {
        return;
      }

      // A cancel intent persisted before the timeout CAS owns the verdict.
      // If another terminal transition won instead, this guarded write is a
      // no-op and that already-persisted outcome remains authoritative.
      await transitionDeployTask(ctx, {
        cancelRequest: "present",
        event: {
          kind: "deployment_task.engine_resolved",
          message:
            "Cancellation was pending at the execution deadline; the task was resolved to cancelled.",
          payload: {
            reason: "cancel-requested-at-deadline",
            verdict: "cancelled",
          },
        },
        expectedLeaseEpoch: input.claim.leaseEpoch,
        from: DEPLOY_TASK_LEASED_STATUSES,
        set: {
          failureDetails: {
            detail: "cancel-requested-at-deadline",
            reason: "cancelled",
          },
        },
        taskId: input.claim.taskId,
        to: "cancelled",
      });
    })().catch((error) => {
      console.error(
        `[deploy-task-engine] deadline resolution failed for ${input.claim.taskId}:`,
        error
      );
    });
  }, ctx.cadence.maxActiveRunMs);

  activeRun = {
    controller,
    deadlineTimer,
    handle,
    leaseEpoch: input.claim.leaseEpoch,
    renewTimer,
    taskId: input.claim.taskId,
  };
  runtime.activeRuns.set(input.claim.taskId, activeRun);

  const done = (async () => {
    try {
      await input.run(handle);
      if (controller.signal.reason instanceof DeployTaskRunTimeoutError) {
        await deadlineResolution;
        return;
      }
      if (handle.outcome() == null) {
        const failureMessage = deploymentFailureMessage("runner-error");
        await handle.fail({
          error: failureMessage,
          event: {
            kind: "deployment_task.failed",
            message: failureMessage,
            payload: { reason: "runner-error" },
          },
          failureDetails: { failureMessage, reason: "runner-error" },
        });
      }
    } catch (error) {
      await resolveRunError(
        handle,
        controller,
        error,
        () => deadlineResolution
      );
    } finally {
      unregisterActiveRun();
    }
  })();

  return { done, handle };
}

async function resolveRunError(
  handle: DeployTaskHandle,
  controller: AbortController,
  error: unknown,
  deadlineResolution: () => Promise<void> | null
): Promise<void> {
  if (handle.outcome() != null) {
    if (!isDeployTaskAbortError(error)) {
      console.error(
        `[deploy-task-engine] runner error after outcome for ${handle.taskId}:`,
        error
      );
    }
    return;
  }
  const reason = controller.signal.aborted ? controller.signal.reason : error;
  try {
    if (
      reason instanceof DeployTaskRunTimeoutError ||
      error instanceof DeployTaskRunTimeoutError
    ) {
      await deadlineResolution();
      return;
    }
    if (
      reason instanceof DeployTaskRunCancelledError ||
      error instanceof DeployTaskRunCancelledError
    ) {
      // Runner unwound from a cancel without acknowledging on its own.
      await handle.acknowledgeCancel();
      return;
    }
    if (
      reason instanceof DeployTaskShutdownError ||
      reason instanceof DeployTaskRunSupersededError ||
      error instanceof DeployTaskRunSupersededError
    ) {
      // Shutdown drain or the winning execution owns the row now.
      return;
    }
    const failureMessage = deploymentFailureMessage("runner-error");
    await handle.fail({
      error: failureMessage,
      event: {
        kind: "deployment_task.failed",
        message: failureMessage,
        payload: { reason: "runner-error" },
      },
      failureDetails: { failureMessage, reason: "runner-error" },
    });
  } catch (fallbackError) {
    if (!(fallbackError instanceof DeployTaskRunSupersededError)) {
      console.error(
        `[deploy-task-engine] outcome fallback failed for ${handle.taskId}:`,
        fallbackError
      );
    }
  }
}
