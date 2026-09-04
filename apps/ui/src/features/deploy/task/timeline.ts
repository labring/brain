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

export type DeploymentAccessEndpointProtocol = "http" | "https" | "ws" | "wss";

export type DeploymentAccessEndpointObserver =
  | { addressId: string; apName: string; kind: "ap-public-address" }
  | { kind: "declared" }
  | { kind: "ingress"; name: string };

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
  | {
      id: string;
      kind: "AccessEndpoint";
      label: string;
      namespace: string;
      observer: DeploymentAccessEndpointObserver;
      protocol: DeploymentAccessEndpointProtocol;
      url?: string;
    }
  /** Legacy v1 result reference. New writers use AccessEndpoint. */
  | { apName: string; id: string; kind: "PublicAccess"; namespace: string }
  /** Legacy v1 result reference. New writers use AccessEndpoint. */
  | {
      kind: "TemplatePublicAccess";
      name: string;
      namespace: string;
      url: string;
    }
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

export const DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY =
  "deployment-task-terminal-failure";

export function isDeploymentTaskTerminalFailureEventKey(
  value: unknown
): boolean {
  return (
    value === DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY ||
    value === "deployment_task.failed"
  );
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

/**
 * The user-facing conclusion of a Deployment Task: the product is usable now.
 * It is deliberately separate from Deployment Timeline Steps, which stay the
 * internal evidence, and from the raw result-resource cards, which say that a
 * Kubernetes object is healthy — not that a person can start using the product.
 *
 * Every field is supplied by the task contract. The UI renders what is here
 * and omits what is not; it never infers an instruction, an entry point or a
 * protocol from names, URLs or deployment status (issue #160).
 */
export const DEPLOYMENT_TASK_SUCCESS_CONTRACT_VERSION = 2;

/** A declared, probe-verified way to reach the deployed product. */
export interface DeploymentTaskSuccessEntry {
  /** What the address is for, e.g. "Server address". Omitted when the
   * contract declares an address without naming it; the UI then shows the
   * address alone rather than inventing a label. */
  label?: string;
  /** Explicit protocol for v2 records. Missing on historical v1 records. */
  protocol?: DeploymentAccessEndpointProtocol;
  /** Absolute access URL exactly as declared — never derived by the UI. */
  url: string;
}

/** One first-use instruction, ordered as the user should perform it. */
export interface DeploymentTaskSuccessStep {
  /** Optional second line, e.g. the address to paste. */
  detail?: string;
  label: string;
}

/** How many required entry probes passed, for the compact summary line. */
export interface DeploymentTaskSuccessVerification {
  passed: number;
  total: number;
}

export interface DeploymentTaskSuccessSnapshot {
  /** Labels the version of the product contract this record was written against. */
  contractVersion: number;
  /** Entries in contract priority order; the first one is the primary action. */
  entries?: DeploymentTaskSuccessEntry[];
  guidance?: DeploymentTaskSuccessStep[];
  /** Contract headline; wins over the UI's default "You can start using it". */
  headline?: string;
  openActionLabel?: string;
  productId?: string;
  productName?: string;
  /**
   * Timeline revision this record was attached at. Doubles as the celebration
   * idempotency key (task id + revision), so a refresh or a duplicate stream
   * snapshot can never replay the confetti.
   */
  revision: number;
  verification?: DeploymentTaskSuccessVerification;
  verifiedAt: string;
}

/** What a caller may attach; the revision and stamp are owned by the timeline. */
export type DeploymentTaskSuccessAttachment = Omit<
  DeploymentTaskSuccessSnapshot,
  "contractVersion" | "revision" | "verifiedAt"
> &
  Partial<Pick<DeploymentTaskSuccessSnapshot, "contractVersion">> &
  Pick<Partial<DeploymentTaskSuccessSnapshot>, "verifiedAt">;

export interface DeploymentTaskTimelineSnapshot {
  /** Independent server stamp proving AI timeline fields were rebuilt safely. */
  publicProjectionVersion?: number;
  revision: number;
  status: DeployTaskStatus;
  steps: DeploymentTimelineStep[];
  /** Verified usability conclusion, appended once deployment + probes pass. */
  success?: DeploymentTaskSuccessSnapshot;
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
    case "configure":
      switch (input.runner.kind) {
        case "template":
          return "prepare-template";
        case "ai":
          return "generate-deployment";
        case "direct":
          return null;
        default:
          return input.runner satisfies never;
      }
    case "queued":
    case "resolve-target":
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

export function applyDeploymentOutputProgressToTimeline(
  timeline: DeploymentTaskTimelineSnapshot,
  input: {
    complete: boolean;
    event: DeploymentTimelineEvent;
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  return appendStepEvent(
    markTimelineStep(timeline, {
      status: input.complete ? "completed" : "running",
      stepId: "generate-deployment",
      updatedAt: input.updatedAt,
    }),
    {
      event: input.event,
      stepId: "generate-deployment",
      updatedAt: input.updatedAt,
    }
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
    failRequired?: boolean;
    lastObservedStatus: string;
    stepId: string;
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  const failRequired = input.failRequired ?? true;
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
        requiredTimeout = card.required && failRequired;
        const timeoutScope = card.required ? "required" : "optional";
        const status: DeploymentResultResourceCardStatus =
          card.required && failRequired ? "failed" : "unknown";
        return {
          ...card,
          events: appendDedupeEvent(card.events, {
            createdAt: input.updatedAt,
            dedupeKey: `${card.id}:timeout`,
            id: `${card.id}:timeout`,
            message: `Result resource timed out while ${timeoutScope}: ${input.lastObservedStatus}.`,
            reason: "ResourceReadinessTimeout",
            severity: card.required && failRequired ? "error" : "warning",
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
    case "AccessEndpoint":
      return `${ref.kind}:${ref.namespace}:${ref.id}`;
    case "TemplatePublicAccess":
      return `${ref.kind}:${ref.namespace}:${ref.name}:${ref.url}`;
    case "TemplateWorkload":
      return `${ref.kind}:${ref.namespace}:${ref.workloadKind}:${ref.name}`;
    default:
      return ref satisfies never;
  }
}

/* ---------------------------------------------------------------------------
 * Verified-success record
 * ------------------------------------------------------------------------- */

const MAX_SUCCESS_ENTRIES = 8;
const MAX_SUCCESS_GUIDANCE_STEPS = 6;
const MAX_SUCCESS_HEADLINE_LENGTH = 140;
const MAX_SUCCESS_LABEL_LENGTH = 140;
const MAX_SUCCESS_DETAIL_LENGTH = 280;
const MAX_SUCCESS_URL_LENGTH = 2048;
const MAX_SUCCESS_VERIFICATION_TOTAL = 64;

/** Trims to a single presentable line, or drops the value when unusable. */
function successText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const text = value.trim();
  if (text === "") {
    return undefined;
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

/**
 * Accepts only an address that was actually declared. Deriving a URL — let
 * alone a protocol such as wss from https — is out of contract (#160).
 */
function successUrl(value: unknown): string | undefined {
  return successText(value, MAX_SUCCESS_URL_LENGTH);
}

function accessProtocol(
  value: string
): DeploymentAccessEndpointProtocol | undefined {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "" || url.hash !== "") {
      return undefined;
    }
    switch (url.protocol) {
      case "http:":
        return "http";
      case "https:":
        return "https";
      case "ws:":
        return "ws";
      case "wss:":
        return "wss";
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function successCount(value: unknown, max: number): number | undefined {
  return Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= max
    ? (value as number)
    : undefined;
}

function successEntries(
  value: unknown,
  contractVersion: number
): DeploymentTaskSuccessEntry[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value.flatMap((item) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const url = successUrl(candidate.url);
    const protocol = url == null ? undefined : accessProtocol(url);
    if (
      url == null ||
      protocol == null ||
      (contractVersion < 2 && protocol !== "http" && protocol !== "https") ||
      (candidate.protocol != null && candidate.protocol !== protocol)
    ) {
      return [];
    }
    const label = successText(candidate.label, MAX_SUCCESS_LABEL_LENGTH);
    return [
      {
        ...(label == null ? {} : { label }),
        ...(contractVersion < 2 ? {} : { protocol }),
        url,
      },
    ];
  });
  return entries.slice(0, MAX_SUCCESS_ENTRIES);
}

function successGuidance(
  value: unknown
): DeploymentTaskSuccessStep[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const steps = value.flatMap((item) => {
    if (typeof item === "string") {
      const label = successText(item, MAX_SUCCESS_LABEL_LENGTH);
      return label == null ? [] : [{ label }];
    }
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const candidate = item as Record<string, unknown>;
    const label = successText(candidate.label, MAX_SUCCESS_LABEL_LENGTH);
    if (label == null) {
      return [];
    }
    const detail = successText(candidate.detail, MAX_SUCCESS_DETAIL_LENGTH);
    return [{ ...(detail == null ? {} : { detail }), label }];
  });
  return steps.slice(0, MAX_SUCCESS_GUIDANCE_STEPS);
}

function successVerification(
  value: unknown
): DeploymentTaskSuccessVerification | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const total = successCount(candidate.total, MAX_SUCCESS_VERIFICATION_TOTAL);
  const passed = successCount(candidate.passed, MAX_SUCCESS_VERIFICATION_TOTAL);
  if (total == null || passed == null || passed > total) {
    return undefined;
  }
  return { passed, total };
}

function isoTimestamp(value: unknown): string | undefined {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}

/**
 * Rebuilds a success record field by field from untrusted JSON. Anything that
 * is not a presentable string, a declared access address or a sane count is
 * dropped rather than rendered, so a stream payload can never put arbitrary
 * content into the Timeline (the AI projection gate reuses this on every read).
 */
export function sanitizeDeploymentTaskSuccess(
  value: unknown,
  fallback: { revision: number; verifiedAt: string }
): DeploymentTaskSuccessSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const contractVersion =
    Number.isSafeInteger(candidate.contractVersion) &&
    (candidate.contractVersion as number) > 0
      ? (candidate.contractVersion as number)
      : DEPLOYMENT_TASK_SUCCESS_CONTRACT_VERSION;
  const headline = successText(candidate.headline, MAX_SUCCESS_HEADLINE_LENGTH);
  const openActionLabel = successText(
    candidate.openActionLabel,
    MAX_SUCCESS_LABEL_LENGTH
  );
  const productId = successText(candidate.productId, MAX_SUCCESS_LABEL_LENGTH);
  const productName = successText(
    candidate.productName,
    MAX_SUCCESS_LABEL_LENGTH
  );
  const entries = successEntries(candidate.entries, contractVersion);
  const guidance = successGuidance(candidate.guidance);
  const verification = successVerification(candidate.verification);
  const revision = successCount(candidate.revision, Number.MAX_SAFE_INTEGER);
  return {
    contractVersion,
    ...(entries == null || entries.length === 0 ? {} : { entries }),
    ...(headline == null ? {} : { headline }),
    ...(guidance == null || guidance.length === 0 ? {} : { guidance }),
    ...(openActionLabel == null ? {} : { openActionLabel }),
    ...(productId == null ? {} : { productId }),
    ...(productName == null ? {} : { productName }),
    revision: revision ?? fallback.revision,
    verifiedAt: isoTimestamp(candidate.verifiedAt) ?? fallback.verifiedAt,
    ...(verification == null ? {} : { verification }),
  };
}

/**
 * Content identity of a success record, ignoring the revision it happened to
 * be stamped with. Two identical signatures mean "the same conclusion", which
 * is what makes attaching success idempotent for a re-entrant runner.
 */
export function deploymentTaskSuccessSignature(
  success: DeploymentTaskSuccessSnapshot
): string {
  return JSON.stringify({
    entries: (success.entries ?? []).map((entry) => [
      entry.label ?? "",
      entry.url,
    ]),
    guidance: (success.guidance ?? []).map((step) => [
      step.detail ?? "",
      step.label,
    ]),
    headline: success.headline ?? "",
    openActionLabel: success.openActionLabel ?? "",
    productId: success.productId ?? "",
    productName: success.productName ?? "",
    verification: success.verification
      ? [success.verification.passed, success.verification.total]
      : null,
    verifiedAt: success.verifiedAt,
  });
}

/**
 * Turns what the runner actually observed into the claim it may publish, or
 * null when there is nothing to claim.
 *
 * A success record needs evidence: at least one required result resource
 * reached the running state — the same bar as
 * `deploymentTimelineResultReadinessReached`. A task that completed with no
 * required result resource proved nothing about usability, so it gets no
 * record and the Timeline keeps reporting progress instead of announcing a
 * result the user cannot verify (issue #160).
 */
export function deploymentTaskSuccessFromResultReadiness(input: {
  productName: string | null;
  requiredRunningCards: number;
}): DeploymentTaskSuccessAttachment | null {
  if (input.requiredRunningCards < 1) {
    return null;
  }
  return {
    ...(input.productName == null ? {} : { productName: input.productName }),
    verification: {
      passed: input.requiredRunningCards,
      total: input.requiredRunningCards,
    },
  };
}

/**
 * Reads the evidence back off the Timeline itself and returns the claim it can
 * support, or null while the Timeline is still proving its case.
 *
 * Going through the snapshot instead of the runner's own list of resources is
 * what keeps the two from disagreeing: the verification count is exactly the
 * required result resources the user can see running, so a workload that is
 * ready while its entry probe is still pending claims nothing at all.
 */
export function deploymentTaskSuccessFromTimeline(
  timeline: DeploymentTaskTimelineSnapshot,
  input: { productName: string | null }
): DeploymentTaskSuccessAttachment | null {
  if (!deploymentTimelineResultReadinessReached(timeline)) {
    return null;
  }
  const runningCards = timeline.steps
    .flatMap((step) => step.resultCards ?? [])
    .filter((card) => card.required && card.status === "running");
  const endpointEntries = runningCards.flatMap((card) => {
    switch (card.resultRef.kind) {
      case "AccessEndpoint":
        return card.resultRef.url == null
          ? []
          : [
              {
                label: card.resultRef.label,
                protocol: card.resultRef.protocol,
                url: card.resultRef.url,
              },
            ];
      case "TemplatePublicAccess":
        return [{ label: "Public domain", url: card.resultRef.url }];
      default:
        return [];
    }
  });
  const uniqueEntries = endpointEntries.filter(
    (entry, index) =>
      endpointEntries.findIndex((candidate) => candidate.url === entry.url) ===
      index
  );
  const success = deploymentTaskSuccessFromResultReadiness({
    productName: input.productName,
    requiredRunningCards: runningCards.length,
  });
  return success == null
    ? null
    : {
        ...success,
        ...(uniqueEntries.length === 0
          ? { headline: "Deployment completed" }
          : { entries: uniqueEntries }),
      };
}

/**
 * Appends the user-facing success conclusion to the Timeline.
 *
 * Callers invoke this only once Deployment Result Readiness has been reached
 * and every required entry probe has passed — the presence of `success` is
 * itself the claim that the product is usable, so a bare `completed` status
 * must never reach this helper on its own. Re-attaching the same conclusion is
 * a no-op: it neither bumps `revision` nor replays the celebration.
 */
export function attachDeploymentTaskSuccess(
  timeline: DeploymentTaskTimelineSnapshot,
  input: {
    success: DeploymentTaskSuccessAttachment;
    updatedAt: string;
  }
): DeploymentTaskTimelineSnapshot {
  // Callers are typed, but the value often arrives from a stream or a
  // persisted blob: anything that is not a record is rejected, not rendered.
  if (
    typeof input.success !== "object" ||
    input.success === null ||
    Array.isArray(input.success)
  ) {
    return timeline;
  }
  const verifiedAt = isoTimestamp(input.success.verifiedAt) ?? input.updatedAt;
  const candidate = sanitizeDeploymentTaskSuccess(
    {
      ...input.success,
      contractVersion:
        input.success.contractVersion ??
        DEPLOYMENT_TASK_SUCCESS_CONTRACT_VERSION,
      verifiedAt,
    },
    { revision: timeline.revision + 1, verifiedAt }
  );
  if (candidate == null) {
    return timeline;
  }
  if (
    timeline.success != null &&
    deploymentTaskSuccessSignature(timeline.success) ===
      deploymentTaskSuccessSignature(candidate)
  ) {
    return timeline;
  }
  const next = bumpRevision(
    { ...timeline, success: { ...candidate, revision: timeline.revision + 1 } },
    input.updatedAt
  );
  return {
    ...next,
    success: { ...candidate, revision: next.revision },
  };
}
