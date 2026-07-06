import { and, eq, inArray } from "drizzle-orm";

import type {
  DeploymentTaskCanvasProjection,
  DeployTaskArtifactSummary,
  DeployTaskBlockingInput,
  DeployTaskFailureDetails,
  DeployTaskPhase,
  DeployTaskRow,
} from "../schema";
import { deployTasks } from "../schema";
import type {
  DeploymentTaskTimelineSnapshot,
  DeploymentTaskTimelineUpdate,
} from "../timeline";
import { deploymentTaskTimelineFromTaskRecord } from "../timeline-storage";
import type { DeployTaskEngineContext } from "./context";
import {
  DeployTaskRunCancelledError,
  DeployTaskRunSupersededError,
} from "./errors";
import {
  appendDeployTaskEvent,
  DEPLOY_TASK_ACTIVE_STATUSES,
  DEPLOY_TASK_LEASED_STATUSES,
  type DeployTaskTransitionEvent,
  isDeployTaskTerminalStatus,
  transitionDeployTask,
} from "./transitions";

export type DeployTaskRunOutcome =
  | "blocked"
  | "cancelled"
  | "completed"
  | "failed";

export interface DeployTaskHandleStateFields {
  artifactSummary?: DeployTaskArtifactSummary;
  blockingInputs?: DeployTaskBlockingInput[];
  canvasProjection?: DeploymentTaskCanvasProjection;
  gatewaySessionId?: string | null;
  gatewayStateSnapshot?: DeployTaskRow["gatewayStateSnapshot"];
  gatewayThreadId?: string | null;
  gatewayTurnId?: string | null;
  gatewayUrl?: string | null;
  phase?: DeployTaskPhase;
  previewUrl?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  resultUrl?: string | null;
  runtimeName?: string | null;
  runtimeProvider?: string | null;
  runtimeState?: string | null;
  timelineSnapshot?: DeploymentTaskTimelineSnapshot | null;
}

export interface DeployTaskHandle {
  /** Terminal ack for a cancel request observed by this run. */
  acknowledgeCancel(input?: {
    event?: DeployTaskTransitionEvent;
    failureDetails?: DeployTaskFailureDetails | null;
  }): Promise<void>;
  /** running → applying, once artifacts exist and apply begins. */
  beginApplying(event?: DeployTaskTransitionEvent): Promise<void>;
  /**
   * Reads the pending cancel intent; throws the typed cancel/supersede error
   * so runner control flow unwinds to its abort path.
   */
  checkpoint(): Promise<void>;
  complete(input?: { event?: DeployTaskTransitionEvent }): Promise<void>;
  emitEvent(event: DeployTaskTransitionEvent): Promise<void>;
  fail(input: {
    error: string;
    event?: DeployTaskTransitionEvent;
    failureDetails?: DeployTaskFailureDetails | null;
    phase?: DeployTaskPhase;
  }): Promise<void>;
  readonly leaseEpoch: number;
  readonly namespace: string;
  outcome(): DeployTaskRunOutcome | null;
  /** running → blocked; releases the lease. The runner must then exit. */
  requestInputs(input: {
    blockingInputs: DeployTaskBlockingInput[];
    event?: DeployTaskTransitionEvent;
    phase?: DeployTaskPhase;
  }): Promise<void>;
  setArtifacts(summary: DeployTaskArtifactSummary): Promise<void>;
  setState(fields: DeployTaskHandleStateFields): Promise<void>;
  /** Aborted on cancel request, shutdown, or supersession. */
  readonly signal: AbortSignal;
  readonly taskId: string;
  updateTimeline(input: {
    event?: DeployTaskTransitionEvent;
    update: DeploymentTaskTimelineUpdate;
  }): Promise<void>;
}

export interface CreateDeployTaskHandleInput {
  controller: AbortController;
  leaseEpoch: number;
  namespace: string;
  onEnded?: (outcome: DeployTaskRunOutcome) => void;
  taskId: string;
}

export function createDeployTaskHandle(
  ctx: DeployTaskEngineContext,
  input: CreateDeployTaskHandleInput
): DeployTaskHandle {
  let outcome: DeployTaskRunOutcome | null = null;

  function ended(next: DeployTaskRunOutcome): void {
    outcome = next;
    input.onEnded?.(next);
  }

  function assertLive(): void {
    if (outcome != null) {
      throw new DeployTaskRunSupersededError(
        "Deployment task run already recorded its outcome."
      );
    }
  }

  async function fencedEvent(event: DeployTaskTransitionEvent): Promise<void> {
    const row = await appendDeployTaskEvent(ctx, {
      event,
      expectedLeaseEpoch: input.leaseEpoch,
      from: DEPLOY_TASK_ACTIVE_STATUSES,
      taskId: input.taskId,
    });
    if (row == null) {
      throw new DeployTaskRunSupersededError();
    }
  }

  return {
    leaseEpoch: input.leaseEpoch,
    namespace: input.namespace,
    signal: input.controller.signal,
    taskId: input.taskId,

    async acknowledgeCancel(ack) {
      assertLive();
      const row = await transitionDeployTask(ctx, {
        event: ack?.event ?? {
          kind: "deployment_task.cancelled",
          message: "Deployment task cancelled.",
          payload: {},
        },
        expectedLeaseEpoch: input.leaseEpoch,
        from: DEPLOY_TASK_LEASED_STATUSES,
        set: { failureDetails: ack?.failureDetails ?? null },
        taskId: input.taskId,
        to: "cancelled",
      });
      // A deadline-forced cancel may have resolved the row first; either way
      // the user's intent is satisfied and this run is over.
      ended("cancelled");
      if (row == null) {
        return;
      }
    },

    async beginApplying(event) {
      assertLive();
      const row = await transitionDeployTask(ctx, {
        event,
        expectedLeaseEpoch: input.leaseEpoch,
        from: ["running"],
        set: { phase: "apply" },
        taskId: input.taskId,
        to: "applying",
      });
      if (row == null) {
        throw new DeployTaskRunSupersededError();
      }
    },

    async checkpoint() {
      assertLive();
      const [row] = await ctx.db
        .select({
          cancelRequestedAt: deployTasks.cancelRequestedAt,
          leaseEpoch: deployTasks.leaseEpoch,
          status: deployTasks.status,
        })
        .from(deployTasks)
        .where(eq(deployTasks.id, input.taskId))
        .limit(1);
      if (
        row == null ||
        row.leaseEpoch !== input.leaseEpoch ||
        isDeployTaskTerminalStatus(row.status)
      ) {
        throw new DeployTaskRunSupersededError();
      }
      if (row.cancelRequestedAt != null) {
        if (!input.controller.signal.aborted) {
          input.controller.abort(new DeployTaskRunCancelledError());
        }
        throw new DeployTaskRunCancelledError();
      }
    },

    async complete(completion) {
      assertLive();
      const row = await transitionDeployTask(ctx, {
        event: completion?.event ?? {
          kind: "deployment_task.completed",
          message: "Deployment task completed.",
          phase: "completed",
          payload: {},
        },
        expectedLeaseEpoch: input.leaseEpoch,
        from: ["applying"],
        set: { phase: "completed" },
        taskId: input.taskId,
        to: "completed",
      });
      if (row == null) {
        throw new DeployTaskRunSupersededError();
      }
      ended("completed");
    },

    async emitEvent(event) {
      assertLive();
      await fencedEvent(event);
    },

    async fail(failure) {
      assertLive();
      const row = await transitionDeployTask(ctx, {
        event: failure.event ?? {
          kind: "deployment_task.failed",
          message: failure.error,
          phase: failure.phase,
          payload: {},
        },
        expectedLeaseEpoch: input.leaseEpoch,
        from: DEPLOY_TASK_LEASED_STATUSES,
        set: {
          error: failure.error,
          failureDetails: failure.failureDetails ?? null,
          ...(failure.phase == null ? {} : { phase: failure.phase }),
        },
        taskId: input.taskId,
        to: "failed",
      });
      ended("failed");
      if (row == null) {
        // The engine already resolved this run (reaper, forced cancel); the
        // terminal guard starved this write, which is the designed outcome.
        return;
      }
    },

    outcome() {
      return outcome;
    },

    async requestInputs(request) {
      assertLive();
      const row = await transitionDeployTask(ctx, {
        event: request.event ?? {
          kind: "deployment_task.inputs_requested",
          message: "Deployment task is waiting for additional input.",
          phase: request.phase ?? "configure",
          payload: {
            inputKeys: request.blockingInputs.map(
              (item) => item.key ?? item.id
            ),
            redacted: true,
          },
        },
        expectedLeaseEpoch: input.leaseEpoch,
        from: ["running"],
        set: {
          blockingInputs: request.blockingInputs,
          phase: request.phase ?? "configure",
        },
        taskId: input.taskId,
        to: "blocked",
      });
      if (row == null) {
        throw new DeployTaskRunSupersededError();
      }
      ended("blocked");
    },

    async setArtifacts(summary) {
      await this.setState({ artifactSummary: summary });
    },

    async setState(fields) {
      assertLive();
      const rows = await ctx.db
        .update(deployTasks)
        .set({ ...fields, updatedAt: new Date() })
        .where(
          and(
            eq(deployTasks.id, input.taskId),
            eq(deployTasks.leaseEpoch, input.leaseEpoch),
            inArray(deployTasks.status, [...DEPLOY_TASK_ACTIVE_STATUSES])
          )
        )
        .returning({
          id: deployTasks.id,
          namespace: deployTasks.namespace,
          projectId: deployTasks.projectId,
        });
      const row = rows[0];
      if (row == null) {
        throw new DeployTaskRunSupersededError();
      }
      try {
        await ctx.notify.publish({
          kind: "change",
          namespace: row.namespace,
          projectId: row.projectId,
          taskId: row.id,
        });
      } catch (error) {
        console.error("[deploy-task-engine] notify publish failed:", error);
      }
    },

    async updateTimeline(timelineInput) {
      assertLive();
      const [existing] = await ctx.db
        .select()
        .from(deployTasks)
        .where(eq(deployTasks.id, input.taskId))
        .limit(1);
      if (existing == null || existing.leaseEpoch !== input.leaseEpoch) {
        throw new DeployTaskRunSupersededError();
      }
      const nextTimeline: DeploymentTaskTimelineSnapshot = timelineInput.update(
        deploymentTaskTimelineFromTaskRecord(existing)
      );
      await this.setState({
        ...(timelineInput.event?.phase == null
          ? {}
          : { phase: timelineInput.event.phase }),
        timelineSnapshot: nextTimeline,
      });
      if (timelineInput.event != null) {
        await fencedEvent(timelineInput.event);
      }
    },
  };
}
