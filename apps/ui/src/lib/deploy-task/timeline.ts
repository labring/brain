import type {
  DeploymentTaskRunner,
  DeploymentTaskSource,
  DeployTaskPhase,
  DeployTaskStatus,
} from "./schema";

export type DeploymentTimelineStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "skipped";

export type DeploymentResultResourceCardStatus =
  | "pending"
  | "creating"
  | "running"
  | "blocked"
  | "failed"
  | "unknown";

export type DeploymentTimelineEventSeverity =
  | "info"
  | "success"
  | "warning"
  | "error";

export type DeploymentTimelineEventSource =
  | "runner"
  | "resource-observer"
  | "kubernetes-event"
  | "health-check";

export type DeploymentResultResourceRef =
  | { kind: "AP"; name: string; namespace: string }
  | { kind: "DB"; name: string; namespace: string }
  | { apName: string; id: string; kind: "PublicAccess"; namespace: string }
  | {
      kind: "TemplateWorkload";
      name: string;
      namespace: string;
      workloadKind: string;
    };

export interface DeploymentTimelineEvent {
  createdAt: string;
  dedupeKey?: string;
  id: string;
  message: string;
  reason?: string;
  severity?: DeploymentTimelineEventSeverity;
  source?: DeploymentTimelineEventSource;
}

export interface DeploymentResultResourceCard {
  events: DeploymentTimelineEvent[];
  id: string;
  latestStatusText?: string;
  required: boolean;
  resultRef: DeploymentResultResourceRef;
  status: DeploymentResultResourceCardStatus;
  title: string;
}

export interface DeploymentTimelineStep {
  events: DeploymentTimelineEvent[];
  id: string;
  label: string;
  order: number;
  resultCards?: DeploymentResultResourceCard[];
  status: DeploymentTimelineStepStatus;
}

export interface DeploymentTaskTimelineSnapshot {
  revision: number;
  status: DeployTaskStatus;
  steps: DeploymentTimelineStep[];
  taskId: string;
  updatedAt: string;
}

export interface TimelineStepDeclaration {
  id: string;
  label: string;
  order?: number;
}

export type DeploymentTaskTimelineUpdate = (
  timeline: DeploymentTaskTimelineSnapshot
) => DeploymentTaskTimelineSnapshot;

export function createDeploymentTaskTimeline(input: {
  status: DeployTaskStatus;
  taskId: string;
  updatedAt: string;
}): DeploymentTaskTimelineSnapshot {
  return {
    revision: 0,
    status: input.status,
    steps: [],
    taskId: input.taskId,
    updatedAt: input.updatedAt,
  };
}

export function deploymentTimelineStepsForRunner(
  runner: DeploymentTaskRunner,
  source?: DeploymentTaskSource
): TimelineStepDeclaration[] {
  switch (runner.kind) {
    case "direct":
      return [
        { id: "validate-settings", label: "Validate settings", order: 0 },
        { id: "create-resources", label: "Create resources", order: 1 },
      ];
    case "template":
      return [
        { id: "prepare-template", label: "Prepare template", order: 0 },
        { id: "create-resources", label: "Create resources", order: 1 },
      ];
    case "ai":
      return [
        { id: "prepare-workspace", label: "Prepare workspace", order: 0 },
        {
          id: "analyze-source",
          label:
            source?.kind === "prompt"
              ? "Analyze request"
              : "Analyze repository",
          order: 1,
        },
        { id: "generate-deployment", label: "Generate deployment", order: 2 },
        { id: "create-resources", label: "Create resources", order: 3 },
      ];
    default:
      return runner satisfies never;
  }
}

export function deploymentTimelineFailureStepId(input: {
  phase: DeployTaskPhase;
  runner: DeploymentTaskRunner;
  timeline: DeploymentTaskTimelineSnapshot;
}): string | null {
  const runningStep = [...input.timeline.steps]
    .sort((a, b) => a.order - b.order)
    .find((step) => step.status === "running");
  if (runningStep != null) {
    return runningStep.id;
  }

  switch (input.phase) {
    case "prepare":
      return input.runner.kind === "ai" ? "prepare-workspace" : null;
    case "plan":
      switch (input.runner.kind) {
        case "direct":
          return "validate-settings";
        case "template":
          return "prepare-template";
        case "ai":
          return "analyze-source";
        default:
          return input.runner satisfies never;
      }
    case "generate-artifacts":
      switch (input.runner.kind) {
        case "direct":
          return "validate-settings";
        case "template":
          return "prepare-template";
        case "ai":
          return "generate-deployment";
        default:
          return input.runner satisfies never;
      }
    case "apply":
    case "verify":
      return "create-resources";
    case "queued":
    case "resolve-target":
    case "configure":
    case "completed":
      return null;
    default:
      return input.phase satisfies never;
  }
}

export function createDeploymentTaskTimelineForRunner(input: {
  runner: DeploymentTaskRunner;
  source?: DeploymentTaskSource;
  status: DeployTaskStatus;
  taskId: string;
  updatedAt: string;
}): DeploymentTaskTimelineSnapshot {
  return declareTimelineSteps(
    createDeploymentTaskTimeline({
      status: input.status,
      taskId: input.taskId,
      updatedAt: input.updatedAt,
    }),
    {
      steps: deploymentTimelineStepsForRunner(input.runner, input.source),
      updatedAt: input.updatedAt,
    }
  );
}

function bumpRevision(
  timeline: DeploymentTaskTimelineSnapshot,
  updatedAt: string
): DeploymentTaskTimelineSnapshot {
  return {
    ...timeline,
    revision: timeline.revision + 1,
    updatedAt,
  };
}

function hasEvent(
  events: readonly DeploymentTimelineEvent[],
  event: DeploymentTimelineEvent
) {
  const key = event.dedupeKey?.trim();
  if (key) {
    return events.some((existing) => existing.dedupeKey === key);
  }
  return events.some((existing) => existing.id === event.id);
}

function appendDedupeEvent(
  events: readonly DeploymentTimelineEvent[],
  event: DeploymentTimelineEvent
): DeploymentTimelineEvent[] {
  if (hasEvent(events, event)) {
    return [...events];
  }
  return [...events, event];
}

function sortSteps(steps: DeploymentTimelineStep[]): DeploymentTimelineStep[] {
  return [...steps].sort((a, b) => a.order - b.order);
}

export function declareTimelineSteps(
  timeline: DeploymentTaskTimelineSnapshot,
  input: {
    steps: readonly TimelineStepDeclaration[];
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  const existingById = new Map(timeline.steps.map((step) => [step.id, step]));
  const nextSteps = [...timeline.steps];
  for (const [index, declaration] of input.steps.entries()) {
    if (existingById.has(declaration.id)) {
      continue;
    }
    nextSteps.push({
      events: [],
      id: declaration.id,
      label: declaration.label,
      order: declaration.order ?? index,
      status: "pending",
    });
  }

  return bumpRevision(
    {
      ...timeline,
      steps: sortSteps(nextSteps),
    },
    input.updatedAt
  );
}

export function markTimelineStep(
  timeline: DeploymentTaskTimelineSnapshot,
  input: {
    status: DeploymentTimelineStepStatus;
    stepId: string;
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  return bumpRevision(
    {
      ...timeline,
      steps: timeline.steps.map((step) =>
        step.id === input.stepId ? { ...step, status: input.status } : step
      ),
    },
    input.updatedAt
  );
}

export function appendStepEvent(
  timeline: DeploymentTaskTimelineSnapshot,
  input: {
    event: DeploymentTimelineEvent;
    stepId: string;
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  return bumpRevision(
    {
      ...timeline,
      steps: timeline.steps.map((step) =>
        step.id === input.stepId
          ? { ...step, events: appendDedupeEvent(step.events, input.event) }
          : step
      ),
    },
    input.updatedAt
  );
}

export function upsertResultResourceCard(
  timeline: DeploymentTaskTimelineSnapshot,
  input: {
    card: Omit<DeploymentResultResourceCard, "events"> & {
      events?: DeploymentTimelineEvent[];
    };
    stepId: string;
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  return bumpRevision(
    {
      ...timeline,
      steps: timeline.steps.map((step) => {
        if (step.id !== input.stepId) {
          return step;
        }
        const existingCards = step.resultCards ?? [];
        const existing = existingCards.find(
          (card) => card.id === input.card.id
        );
        const nextCard: DeploymentResultResourceCard = {
          events: existing?.events ?? input.card.events ?? [],
          id: input.card.id,
          latestStatusText: input.card.latestStatusText,
          required: input.card.required,
          resultRef: input.card.resultRef,
          status: input.card.status,
          title: input.card.title,
        };
        const nextCards =
          existing == null
            ? [...existingCards, nextCard]
            : existingCards.map((card) =>
                card.id === input.card.id ? nextCard : card
              );
        return { ...step, resultCards: nextCards };
      }),
    },
    input.updatedAt
  );
}

export function appendCardEvent(
  timeline: DeploymentTaskTimelineSnapshot,
  input: {
    cardId: string;
    event: DeploymentTimelineEvent;
    stepId: string;
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  return bumpRevision(
    {
      ...timeline,
      steps: timeline.steps.map((step) => {
        if (step.id !== input.stepId) {
          return step;
        }
        return {
          ...step,
          resultCards: (step.resultCards ?? []).map((card) =>
            card.id === input.cardId
              ? {
                  ...card,
                  events: appendDedupeEvent(card.events, input.event),
                }
              : card
          ),
        };
      }),
    },
    input.updatedAt
  );
}

export function updateTimelineStatus(
  timeline: DeploymentTaskTimelineSnapshot,
  input: { status: DeployTaskStatus; updatedAt: string }
): DeploymentTaskTimelineSnapshot {
  if (timeline.status === input.status) {
    return timeline;
  }
  return bumpRevision({ ...timeline, status: input.status }, input.updatedAt);
}

export function applyResultResourceTimeout(
  timeline: DeploymentTaskTimelineSnapshot,
  input: {
    cardId: string;
    lastObservedStatus: string;
    stepId: string;
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  let requiredTimeout = false;
  const nextSteps = timeline.steps.map((step) => {
    if (step.id !== input.stepId) {
      return step;
    }
    return {
      ...step,
      resultCards: (step.resultCards ?? []).map((card) => {
        if (card.id !== input.cardId) {
          return card;
        }
        requiredTimeout = card.required;
        const timeoutScope = card.required ? "required" : "optional";
        const status: DeploymentResultResourceCardStatus = card.required
          ? "failed"
          : "unknown";
        return {
          ...card,
          events: appendDedupeEvent(card.events, {
            createdAt: input.updatedAt,
            dedupeKey: `${card.id}:timeout`,
            id: `${card.id}:timeout`,
            message: `Result resource timed out while ${timeoutScope}: ${input.lastObservedStatus}.`,
            reason: "ResourceReadinessTimeout",
            severity: card.required ? "error" : "warning",
            source: "resource-observer",
          }),
          latestStatusText: input.lastObservedStatus,
          status,
        };
      }),
    };
  });

  return bumpRevision(
    {
      ...timeline,
      status: requiredTimeout ? "failed" : timeline.status,
      steps: nextSteps,
    },
    input.updatedAt
  );
}

export function deploymentTimelineResultReadinessReached(
  timeline: DeploymentTaskTimelineSnapshot
): boolean {
  const cards = timeline.steps.flatMap((step) => step.resultCards ?? []);
  const requiredCards = cards.filter((card) => card.required);
  return (
    requiredCards.length > 0 &&
    requiredCards.every((card) => card.status === "running")
  );
}

export function deploymentResultResourceCardId(
  ref: DeploymentResultResourceRef
): string {
  switch (ref.kind) {
    case "AP":
    case "DB":
      return `${ref.kind}:${ref.namespace}:${ref.name}`;
    case "PublicAccess":
      return `${ref.kind}:${ref.namespace}:${ref.apName}:${ref.id}`;
    case "TemplateWorkload":
      return `${ref.kind}:${ref.namespace}:${ref.workloadKind}:${ref.name}`;
    default:
      return ref satisfies never;
  }
}
