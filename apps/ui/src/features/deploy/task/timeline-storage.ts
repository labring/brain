import {
  deploymentFailureMessage,
  isDeployTaskFailureReason,
} from "./failure-summary";
import { persistableAiDeployTaskTimelineSnapshot } from "./public-artifact-summary";
import type {
  DeploymentTaskRunner,
  DeploymentTaskSource,
  DeployTaskFailureDetails,
  DeployTaskPhase,
  DeployTaskStatus,
} from "./schema";
import {
  createDeploymentTaskTimelineForRunner,
  type DeploymentTaskTimelineSnapshot,
  deploymentTimelineFailureStepId,
} from "./timeline";

export interface DeploymentTaskTimelineTaskRecord {
  failureDetails?: DeployTaskFailureDetails | null;
  id: string;
  phase?: DeployTaskPhase;
  runner: DeploymentTaskRunner;
  source?: DeploymentTaskSource;
  status: DeployTaskStatus;
  timelineSnapshot: DeploymentTaskTimelineSnapshot | null;
  updatedAt: Date | string;
}

function isoDate(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function overlayTerminalFailure(
  timeline: DeploymentTaskTimelineSnapshot,
  task: DeploymentTaskTimelineTaskRecord
): DeploymentTaskTimelineSnapshot {
  if (
    task.status !== "failed" ||
    task.phase == null ||
    timeline.steps.some((step) => step.status === "failed")
  ) {
    return timeline;
  }
  const stepId = deploymentTimelineFailureStepId({
    phase: task.phase,
    runner: task.runner,
    timeline,
  });
  if (stepId == null) {
    return timeline;
  }
  const reason = isDeployTaskFailureReason(task.failureDetails?.reason)
    ? task.failureDetails.reason
    : "unknown";
  const message = deploymentFailureMessage(reason);
  const updatedAt = isoDate(task.updatedAt);
  return {
    ...timeline,
    steps: timeline.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            events: step.events.some(
              (event) => event.dedupeKey === "deployment-task-terminal-failure"
            )
              ? step.events
              : [
                  ...step.events,
                  {
                    createdAt: updatedAt,
                    dedupeKey: "deployment-task-terminal-failure",
                    id: "deployment-task-terminal-failure",
                    message,
                    reason: "DeploymentTaskFailed",
                    severity: "error",
                    source: "runner",
                  },
                ],
            status: "failed" as const,
          }
        : step
    ),
  };
}

export function deploymentTaskTimelineFromTaskRecord(
  task: DeploymentTaskTimelineTaskRecord
): DeploymentTaskTimelineSnapshot {
  if (task.timelineSnapshot != null) {
    // The row's status column is the only source of truth (ADR 0037):
    // status transitions no longer rewrite the persisted snapshot, so the
    // display status derives from the row on every read. The overlay must
    // stay a pure projection — bumping `revision` here would let a read
    // that lands between the runner's timeline write and its status
    // transition outrank every later read, wedging stream clients on the
    // stale intermediate state. `updatedAt` follows the row so snapshots
    // with equal revisions order by actual row write time.
    return overlayTerminalFailure(
      {
        ...task.timelineSnapshot,
        status: task.status,
        updatedAt: isoDate(task.updatedAt),
      },
      task
    );
  }

  return overlayTerminalFailure(
    createDeploymentTaskTimelineForRunner({
      runner: task.runner,
      source: task.source,
      status: task.status,
      taskId: task.id,
      updatedAt: isoDate(task.updatedAt),
    }),
    task
  );
}

/**
 * Persisted AI timelines are rebuilt through their dedicated persistence
 * projection gate. The timeline stamp is therefore proof about this JSON blob
 * only; artifact or blocker versions never upgrade it indirectly.
 */
export function persistableDeploymentTaskTimeline(input: {
  task: DeploymentTaskTimelineTaskRecord;
  timeline: DeploymentTaskTimelineSnapshot;
}): DeploymentTaskTimelineSnapshot {
  if (input.task.runner.kind !== "ai") {
    return input.timeline;
  }
  return persistableAiDeployTaskTimelineSnapshot(input.timeline, {
    failureReason: input.task.failureDetails?.reason,
    taskId: input.task.id,
    updatedAt: isoDate(input.task.updatedAt),
  });
}
