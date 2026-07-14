import "server-only";

import { DeployTaskRunSupersededError } from "./engine/errors";
import type {
  DeployTaskHandle,
  DeployTaskHandleStateFields,
} from "./engine/handle";
import { getActiveDeployTaskHandle } from "./engine/runtime";
import type {
  DeployTaskBlockingInput,
  DeployTaskFailureDetails,
  DeployTaskPhase,
} from "./schema";
import type { DeploymentTaskTimelineUpdate } from "./timeline";
import type { DeployTaskEventInput } from "./types";

/**
 * Runner-side write surface (ADR 0037): every write resolves the current
 * in-process execution's fenced task handle. A superseded or finished run
 * finds no handle and fails closed instead of corrupting state — runner code
 * cannot bypass the engine because this module is its only write path.
 */
export function requireDeployTaskHandle(taskId: string): DeployTaskHandle {
  const handle = getActiveDeployTaskHandle(taskId);
  if (handle == null) {
    throw new DeployTaskRunSupersededError(
      `No active execution owns deploy task ${taskId} in this process.`
    );
  }
  return handle;
}

export async function recordDeployTaskEvent(
  taskId: string,
  input: DeployTaskEventInput
): Promise<void> {
  await requireDeployTaskHandle(taskId).emitEvent({
    kind: input.kind,
    message: input.message,
    payload: input.payload,
    phase: input.phase,
  });
}

/**
 * Non-status task-state writes. Status changes are deliberate transitions:
 * use the explicit helpers below instead.
 */
export async function updateDeployTaskState(
  taskId: string,
  input: DeployTaskHandleStateFields
): Promise<void> {
  await requireDeployTaskHandle(taskId).setState(input);
}

export async function updateDeployTaskTimeline(
  taskId: string,
  input: {
    event?: DeployTaskEventInput;
    update: DeploymentTaskTimelineUpdate;
  }
): Promise<void> {
  await requireDeployTaskHandle(taskId).updateTimeline({
    event:
      input.event == null
        ? undefined
        : {
            kind: input.event.kind,
            message: input.event.message,
            payload: input.event.payload,
            phase: input.event.phase,
          },
    update: input.update,
  });
}

export async function deployTaskBeginApplying(taskId: string): Promise<void> {
  await requireDeployTaskHandle(taskId).beginApplying();
}

export async function deployTaskComplete(
  taskId: string,
  event?: DeployTaskEventInput
): Promise<void> {
  await requireDeployTaskHandle(taskId).complete(
    event == null
      ? undefined
      : {
          event: {
            kind: event.kind,
            message: event.message,
            payload: event.payload,
            phase: event.phase,
          },
        }
  );
}

export async function deployTaskFail(
  taskId: string,
  input: {
    error: string;
    failureDetails?: DeployTaskFailureDetails | null;
    phase?: DeployTaskPhase;
  }
): Promise<void> {
  await requireDeployTaskHandle(taskId).fail(input);
}

export async function deployTaskRequestInputs(
  taskId: string,
  input: {
    blockingInputs: DeployTaskBlockingInput[];
    phase?: DeployTaskPhase;
    state?: DeployTaskHandleStateFields;
  }
): Promise<void> {
  const handle = requireDeployTaskHandle(taskId);
  if (input.state != null) {
    await handle.setState(input.state);
  }
  await handle.requestInputs({
    blockingInputs: input.blockingInputs,
    phase: input.phase,
  });
}

export function deployTaskRunSignal(taskId: string): AbortSignal {
  return requireDeployTaskHandle(taskId).signal;
}

/**
 * Raises the run's typed abort (cancel/shutdown/supersede) if its signal has
 * fired — the cheap guard for long integration loops.
 */
export function throwIfDeployTaskAborted(taskId: string): void {
  const signal = requireDeployTaskHandle(taskId).signal;
  if (!signal.aborted) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new DeployTaskRunSupersededError("Deployment task run was aborted.");
}

export async function deployTaskCheckpoint(taskId: string): Promise<void> {
  await requireDeployTaskHandle(taskId).checkpoint();
}
