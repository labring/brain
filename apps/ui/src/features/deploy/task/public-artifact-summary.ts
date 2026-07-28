import {
  deploymentFailureMessage,
  isDeployTaskFailureReason,
} from "./failure-summary";
import {
  CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
  CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION,
  type DeploymentTaskRunner,
  type DeployTaskArtifactSummary,
  type DeployTaskBlockingInput,
  type DeployTaskEventPayload,
  type DeployTaskFailureReason,
  type DeployTaskStatus,
} from "./schema";
import {
  isSensitiveDeploymentInput,
  legacyAiInputAlias,
  withoutSensitiveArgs,
} from "./sensitive-inputs";
import {
  DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY,
  type DeploymentResultResourceCard,
  type DeploymentResultResourceCardStatus,
  type DeploymentResultResourceRef,
  type DeploymentTaskTimelineSnapshot,
  type DeploymentTimelineEvent,
  type DeploymentTimelineEventSeverity,
  type DeploymentTimelineEventSource,
  type DeploymentTimelineStepStatus,
  isDeploymentTaskTerminalFailureEventKey,
} from "./timeline";

const AI_ENGINE_RESOLUTION_REASONS = new Set([
  "cancel-ack-deadline",
  "interrupted-with-cancel",
]);

const AI_PUBLIC_EVENT_MESSAGES = {
  "deploy_task.created": "Deployment task created.",
  "deploy_task.gateway_event": "Deployment analysis activity received.",
  "deploy_task.gateway_message": "Deployment analysis activity received.",
  "deploy_task.gateway_session_created":
    "Deployment analysis session is ready.",
  "deploy_task.gateway_session_event":
    "Deployment analysis session activity received.",
  "deploy_task.gateway_state": "Deployment analysis state updated.",
  "deploy_task.gateway_timeout": "Deployment analysis timed out.",
  "deploy_task.gateway_turn_completed": "Deployment analysis completed.",
  "deploy_task.gateway_turn_sent": "Deployment analysis started.",
  "deploy_task.gateway_waiting": "Waiting for deployment analysis.",
  "deploy_task.input_submitted": "Additional deployment input submitted.",
  "deployment_task.apply_started": "Applying deployment artifacts.",
  "deployment_task.artifacts_generated": "Deployment artifacts generated.",
  "deployment_task.build_runtime_ready": "Build runtime is ready.",
  "deployment_task.build_runtime_unavailable": "Build runtime is unavailable.",
  "deployment_task.cancel_requested": "Deployment cancellation requested.",
  "deployment_task.cancelled": "Deployment was cancelled.",
  "deployment_task.completed": "Deployment task completed.",
  "deployment_task.deployment_generation_started":
    "Generating deployment artifacts.",
  "deployment_task.direct_validation_completed":
    "Deployment settings validated.",
  "deployment_task.direct_validation_started":
    "Validating deployment settings.",
  "deployment_task.gateway_unavailable":
    "Deployment analysis service is unavailable.",
  "deployment_task.input_ready": "Deployment input is ready.",
  "deployment_task.input_rejected":
    "A deployment configuration value was rejected.",
  "deployment_task.input_required": "Additional deployment input is required.",
  "deployment_task.inputs_requested":
    "Deployment task is waiting for additional input.",
  "deployment_task.output_missing": "Deployment output is unavailable.",
  "deployment_task.output_partial":
    "Deployment output files are partially available.",
  "deployment_task.output_ready": "Deployment output files are ready.",
  "deployment_task.output_repair_started":
    "Repairing incomplete deployment output.",
  "deployment_task.plan_created": "Deployment plan prepared.",
  "deployment_task.prepare_started": "Preparing deployment.",
  "deployment_task.resources_created": "Deployment resources created.",
  "deployment_task.result_identity_reused":
    "Reusing resources from the previous deployment attempt.",
  "deployment_task.result_readiness_reached": "Deployment resources are ready.",
  "deployment_task.result_resource_observed":
    "Deployment resource status updated.",
  "deployment_task.result_resource_timeout":
    "Deployment resource did not become ready before timeout.",
  "deployment_task.resumed": "Deployment run resumed.",
  "deployment_task.runtime_ready": "Deployment runtime is ready.",
  "deployment_task.runtime_waiting": "Waiting for deployment runtime.",
  "deployment_task.skill_install_started": "Installing deployment skills.",
  "deployment_task.source_analysis_completed": "Source analysis completed.",
  "deployment_task.source_analysis_started": "Analyzing deployment source.",
  "deployment_task.started": "Deployment run started.",
  "deployment_task.template_cleanup_completed":
    "Partial deployment resource cleanup completed.",
  "deployment_task.template_cleanup_failed":
    "Partial deployment resource cleanup did not complete.",
  "deployment_task.template_cleanup_started":
    "Cleaning up partial deployment resources.",
  "deployment_task.template_declarations_unavailable":
    "Template declarations are unavailable.",
  "deployment_task.template_preparation_completed":
    "Template preparation completed.",
  "deployment_task.template_preparation_started": "Preparing template.",
  "deployment_task.workspace_clone_ready": "Repository clone is ready.",
  "deployment_task.workspace_clone_started": "Cloning repository.",
  "deployment_task.workspace_ready": "Deployment workspace is ready.",
} as const satisfies Record<string, string>;

const AI_TIMELINE_STEPS = {
  "analyze-source": { label: "Analyze source", order: 1 },
  "create-resources": { label: "Create resources", order: 3 },
  "generate-deployment": { label: "Generate deployment", order: 2 },
  "prepare-workspace": { label: "Prepare workspace", order: 0 },
} as const;

const DEPLOY_TASK_STATUSES = new Set<DeployTaskStatus>([
  "applying",
  "blocked",
  "cancelled",
  "completed",
  "failed",
  "queued",
  "running",
]);
const TIMELINE_STEP_STATUSES = new Set<DeploymentTimelineStepStatus>([
  "blocked",
  "completed",
  "failed",
  "pending",
  "running",
  "skipped",
]);
const RESULT_CARD_STATUSES = new Set<DeploymentResultResourceCardStatus>([
  "blocked",
  "creating",
  "failed",
  "pending",
  "running",
  "unknown",
]);
const TIMELINE_EVENT_SEVERITIES = new Set<DeploymentTimelineEventSeverity>([
  "error",
  "info",
  "success",
  "warning",
]);
const TIMELINE_EVENT_SOURCES = new Set<DeploymentTimelineEventSource>([
  "health-check",
  "kubernetes-event",
  "resource-observer",
  "runner",
]);
const KUBERNETES_NAME_REGEX = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;
const RESOURCE_IDENTIFIER_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function recordValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function publicDeploymentPlan(
  plan: DeployTaskArtifactSummary["deploymentPlan"]
): DeployTaskArtifactSummary["deploymentPlan"] {
  if (plan == null) {
    return undefined;
  }
  return {
    ...plan,
    ...(plan.args == null
      ? {}
      : { args: withoutSensitiveArgs(plan.args, plan.inputs) }),
  };
}

function publicAiDeploymentPlanInput(value: unknown, index: number) {
  const input = recordValue(value);
  const sourceKey = typeof input?.key === "string" ? input.key : null;
  if (input == null || sourceKey == null) {
    return null;
  }

  const sensitive = isSensitiveDeploymentInput({
    key: sourceKey,
    sensitive: input.sensitive === true,
    type: typeof input.type === "string" ? input.type : undefined,
  });
  const key = legacyAiInputAlias(index);
  const sourceType =
    typeof input.type === "string" ? input.type.trim().toLowerCase() : "";
  let publicType = "string";
  if (sensitive) {
    publicType = "secret";
  } else if (sourceType === "boolean" || sourceType === "number") {
    publicType = sourceType;
  }
  return {
    input: {
      key,
      label: "Configuration value",
      ...(typeof input.required === "boolean"
        ? { required: input.required }
        : {}),
      ...(sensitive ? { sensitive: true } : {}),
      type: publicType,
    },
    sourceKey,
  };
}

function publicAiDeploymentPlan(
  plan: DeployTaskArtifactSummary["deploymentPlan"]
): DeployTaskArtifactSummary["deploymentPlan"] {
  if (
    plan == null ||
    plan.kind !== "sealos-template" ||
    !Array.isArray(plan.inputs) ||
    typeof plan.templateName !== "string"
  ) {
    return undefined;
  }

  const projectedInputs = plan.inputs.flatMap((input, index) => {
    const publicInput = publicAiDeploymentPlanInput(input, index);
    return publicInput == null ? [] : [publicInput];
  });
  const inputs = projectedInputs.map((input) => input.input);
  const inputBySourceKey = new Map(
    projectedInputs.map((input) => [input.sourceKey, input.input.key])
  );
  const missingInputKeys = Array.isArray(plan.missingInputKeys)
    ? plan.missingInputKeys.flatMap((key) => {
        if (typeof key !== "string") {
          return [];
        }
        const publicKey = inputBySourceKey.get(key);
        return publicKey == null ? [] : [publicKey];
      })
    : [];

  return {
    kind: "sealos-template",
    inputs,
    templateName: "deployment",
    ...(missingInputKeys.length === 0 ? {} : { missingInputKeys }),
  };
}

const DEPLOY_TASK_BLOCKING_INPUT_TYPES = new Set([
  "confirmation",
  "env",
  "secret",
  "text",
]);

function publicAiBlockingInputType(
  value: unknown
): DeployTaskBlockingInput["type"] {
  return typeof value === "string" &&
    DEPLOY_TASK_BLOCKING_INPUT_TYPES.has(value)
    ? (value as DeployTaskBlockingInput["type"])
    : "text";
}

function publicAiBlockingInput(
  value: unknown,
  publicKey: string,
  options: { trustedMetadata: boolean }
): DeployTaskBlockingInput | null {
  const input = recordValue(value);
  const sourceId = typeof input?.id === "string" ? input.id : null;
  const sourceKey = typeof input?.key === "string" ? input.key : null;
  const canonicalKey = sourceKey ?? sourceId;
  if (input == null || canonicalKey == null) {
    return null;
  }
  const sourceType = publicAiBlockingInputType(input.type);
  const sensitive = isSensitiveDeploymentInput({
    key: canonicalKey,
    sensitive: input.sensitive === true,
    type: sourceType,
  });
  const valueType =
    typeof input.valueType === "string" &&
    ["boolean", "number"].includes(input.valueType.trim().toLowerCase())
      ? input.valueType.trim().toLowerCase()
      : null;
  const sourceLabel = typeof input.label === "string" ? input.label.trim() : "";
  return {
    id: publicKey,
    key: publicKey,
    label:
      options.trustedMetadata && sourceLabel !== ""
        ? sourceLabel
        : "Configuration value",
    required: typeof input.required === "boolean" ? input.required : true,
    type: sensitive ? "secret" : sourceType,
    ...(sensitive ? { sensitive: true } : {}),
    ...(sensitive || valueType == null ? {} : { valueType }),
  };
}

function publicAiBlockingInputKeys(
  blockingInputs: DeployTaskBlockingInput[]
): string[] {
  return blockingInputs.map((_, index) => legacyAiInputAlias(index));
}

export function publicDeployTaskBlockingInputs(
  blockingInputs: DeployTaskBlockingInput[],
  options: {
    runner: DeploymentTaskRunner;
    trustedMetadata?: boolean;
  }
): DeployTaskBlockingInput[] {
  if (options.runner.kind !== "ai") {
    return blockingInputs;
  }
  const publicKeys = publicAiBlockingInputKeys(blockingInputs);
  return blockingInputs.flatMap((input, index) => {
    const publicKey = publicKeys[index];
    if (publicKey == null) {
      return [];
    }
    const publicInput = publicAiBlockingInput(input, publicKey, {
      trustedMetadata: options.trustedMetadata === true,
    });
    return publicInput == null ? [] : [publicInput];
  });
}

function publicAiResources(
  resources: DeployTaskArtifactSummary["resources"],
  trusted: boolean
): DeployTaskArtifactSummary["resources"] {
  if (!(trusted && Array.isArray(resources))) {
    return undefined;
  }
  return resources.flatMap((value) => {
    const resource = recordValue(value);
    if (
      resource == null ||
      typeof resource.apiVersion !== "string" ||
      typeof resource.kind !== "string" ||
      typeof resource.name !== "string" ||
      typeof resource.namespace !== "string"
    ) {
      return [];
    }
    return [
      {
        apiVersion: resource.apiVersion,
        kind: resource.kind,
        name: resource.name,
        namespace: resource.namespace,
      },
    ];
  });
}

function publicAiDeployTaskArtifactSummary(
  summary: DeployTaskArtifactSummary
): DeployTaskArtifactSummary {
  const trusted =
    summary.publicProjectionVersion ===
    CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION;
  const deploymentPlan = publicAiDeploymentPlan(summary.deploymentPlan);
  const resources = publicAiResources(summary.resources, trusted);
  return {
    ...(trusted &&
    Array.isArray(summary.appliedResources) &&
    summary.appliedResources.length > 0
      ? { appliedResources: [{}] }
      : {}),
    ...(deploymentPlan == null ? {} : { deploymentPlan }),
    ...(resources == null ? {} : { resources }),
  };
}

export function publicDeployTaskArtifactSummary(
  summary: DeployTaskArtifactSummary,
  options: { runner: DeploymentTaskRunner }
): DeployTaskArtifactSummary {
  if (options.runner.kind === "ai") {
    return publicAiDeployTaskArtifactSummary(summary);
  }

  const {
    buildResult,
    deliveryManifest: _deliveryManifest,
    deploymentPlan,
    outputJson: _outputJson,
    resourceYamls,
    ...publicSummary
  } = summary;
  const publicPlan = publicDeploymentPlan(deploymentPlan);
  return {
    ...publicSummary,
    ...(buildResult === undefined ? {} : { buildResult }),
    ...(publicPlan == null ? {} : { deploymentPlan: publicPlan }),
    ...(publicPlan == null && resourceYamls !== undefined
      ? { resourceYamls }
      : {}),
  };
}

const AI_OUTPUT_TIMELINE_EVENT_KINDS = [
  "deployment_task.output_partial",
  "deployment_task.output_ready",
] as const;

type AiPublicEventKind = keyof typeof AI_PUBLIC_EVENT_MESSAGES;

function aiPublicTimelineEventKind(
  dedupeKey: unknown
): AiPublicEventKind | null {
  if (typeof dedupeKey !== "string") {
    return null;
  }
  if (Object.hasOwn(AI_PUBLIC_EVENT_MESSAGES, dedupeKey)) {
    return dedupeKey as AiPublicEventKind;
  }
  return (
    AI_OUTPUT_TIMELINE_EVENT_KINDS.find((kind) =>
      dedupeKey.startsWith(`${kind}:`)
    ) ?? null
  );
}

function safeIsoTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length > 30) {
    return fallback;
  }
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value
    ? value
    : fallback;
}

function publicAiTimelineEvent(input: {
  event: DeploymentTimelineEvent;
  failureReason: DeployTaskFailureReason;
  fallbackCreatedAt: string;
  id: string;
  preserveInternalIdentity: boolean;
  retainUnknownPlaceholder: boolean;
}): DeploymentTimelineEvent | null {
  const { event } = input;
  const eventKind = aiPublicTimelineEventKind(event.dedupeKey);
  const isTerminalFailure = isDeploymentTaskTerminalFailureEventKey(
    event.dedupeKey
  );
  if (
    !(isTerminalFailure || eventKind != null || input.retainUnknownPlaceholder)
  ) {
    return null;
  }
  let message = "Deployment progress updated.";
  let publicDedupeKey: string | undefined;
  let reason: string | undefined;
  if (isTerminalFailure) {
    message = deploymentFailureMessage(input.failureReason);
    publicDedupeKey = DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY;
    reason = "DeploymentTaskFailed";
  } else if (eventKind != null) {
    message = AI_PUBLIC_EVENT_MESSAGES[eventKind];
    publicDedupeKey = eventKind;
  }
  const id = input.preserveInternalIdentity
    ? (safeResourceIdentifier(event.id) ?? input.id)
    : input.id;
  const dedupeKey =
    input.preserveInternalIdentity && typeof event.dedupeKey === "string"
      ? event.dedupeKey
      : publicDedupeKey;
  return {
    createdAt: safeIsoTimestamp(event.createdAt, input.fallbackCreatedAt),
    id,
    message,
    ...(dedupeKey == null ? {} : { dedupeKey }),
    ...(reason == null ? {} : { reason }),
    ...(TIMELINE_EVENT_SEVERITIES.has(
      event.severity as DeploymentTimelineEventSeverity
    )
      ? { severity: event.severity }
      : {}),
    ...(TIMELINE_EVENT_SOURCES.has(
      event.source as DeploymentTimelineEventSource
    )
      ? { source: event.source }
      : {}),
  };
}

function projectAiTimelineEvents(input: {
  events: readonly DeploymentTimelineEvent[];
  failureReason: DeployTaskFailureReason;
  fallbackCreatedAt: string;
  idPrefix: string;
  preserveInternalIdentity: boolean;
  retainUnknownPlaceholder: boolean;
}): DeploymentTimelineEvent[] {
  const projected = input.events.flatMap((event, eventIndex) => {
    const publicEvent = publicAiTimelineEvent({
      event,
      failureReason: input.failureReason,
      fallbackCreatedAt: input.fallbackCreatedAt,
      id: `${input.idPrefix}-event-${eventIndex}`,
      preserveInternalIdentity: input.preserveInternalIdentity,
      retainUnknownPlaceholder: input.retainUnknownPlaceholder,
    });
    return publicEvent == null ? [] : [publicEvent];
  });
  if (input.preserveInternalIdentity) {
    return projected;
  }

  const lastIndexByDedupeKey = new Map<string, number>();
  for (const [index, event] of projected.entries()) {
    const dedupeKey = event.dedupeKey?.trim();
    if (dedupeKey) {
      lastIndexByDedupeKey.set(dedupeKey, index);
    }
  }
  return projected.filter((event, index) => {
    const dedupeKey = event.dedupeKey?.trim();
    return !dedupeKey || lastIndexByDedupeKey.get(dedupeKey) === index;
  });
}

function safeKubernetesName(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 253 &&
    KUBERNETES_NAME_REGEX.test(value)
    ? value
    : null;
}

function safeResourceIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 253 &&
    RESOURCE_IDENTIFIER_REGEX.test(value)
    ? value
    : null;
}

function publicAiResultRef(value: unknown): DeploymentResultResourceRef | null {
  const ref = recordValue(value);
  const kind = ref?.kind;
  const namespace = safeKubernetesName(ref?.namespace);
  if (ref == null || namespace == null) {
    return null;
  }
  switch (kind) {
    case "AP":
    case "DB": {
      const name = safeKubernetesName(ref.name);
      return name == null ? null : { kind, name, namespace };
    }
    case "PublicAccess": {
      const apName = safeKubernetesName(ref.apName);
      const id = safeResourceIdentifier(ref.id);
      return apName == null || id == null
        ? null
        : { apName, id, kind, namespace };
    }
    case "TemplateWorkload": {
      const name = safeKubernetesName(ref.name);
      const workloadKind = safeResourceIdentifier(ref.workloadKind);
      return name == null || workloadKind == null
        ? null
        : { kind, name, namespace, workloadKind };
    }
    default:
      return null;
  }
}

function resultCardId(ref: DeploymentResultResourceRef): string {
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

function resultCardTitle(ref: DeploymentResultResourceRef): string {
  switch (ref.kind) {
    case "AP":
      return "Application";
    case "DB":
      return "Database";
    case "PublicAccess":
      return "Public address";
    case "TemplateWorkload":
      return "Workload";
    default:
      return ref satisfies never;
  }
}

function resultCardStatusText(
  status: DeploymentResultResourceCardStatus
): string {
  switch (status) {
    case "blocked":
      return "Blocked";
    case "creating":
      return "Creating";
    case "failed":
      return "Failed";
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "unknown":
      return "Status unavailable";
    default:
      return status satisfies never;
  }
}

function publicAiResultCard(input: {
  card: DeploymentResultResourceCard;
  failureReason: DeployTaskFailureReason;
  fallbackCreatedAt: string;
  index: number;
  preserveInternalIdentity: boolean;
  retainUnknownPlaceholder: boolean;
}): DeploymentResultResourceCard | null {
  const ref = publicAiResultRef(input.card.resultRef);
  if (ref == null) {
    return null;
  }
  const status = RESULT_CARD_STATUSES.has(input.card.status)
    ? input.card.status
    : "unknown";
  return {
    events: projectAiTimelineEvents({
      events: Array.isArray(input.card.events) ? input.card.events : [],
      failureReason: input.failureReason,
      fallbackCreatedAt: input.fallbackCreatedAt,
      idPrefix: `card-${input.index}`,
      preserveInternalIdentity: input.preserveInternalIdentity,
      retainUnknownPlaceholder: input.retainUnknownPlaceholder,
    }),
    id: resultCardId(ref),
    latestStatusText: resultCardStatusText(status),
    required: input.card.required === true,
    resultRef: ref,
    status,
    title: resultCardTitle(ref),
  };
}

function projectAiDeployTaskTimelineSnapshot(
  snapshot: DeploymentTaskTimelineSnapshot,
  options: {
    failureReason?: unknown;
    mode: "persistence" | "public";
    taskId?: string;
    updatedAt?: string;
  }
): DeploymentTaskTimelineSnapshot {
  const snapshotUpdatedAt = safeIsoTimestamp(
    snapshot.updatedAt,
    "1970-01-01T00:00:00.000Z"
  );
  const fallbackCreatedAt = safeIsoTimestamp(
    options.updatedAt,
    snapshotUpdatedAt
  );
  const failureReason = isDeployTaskFailureReason(options.failureReason)
    ? options.failureReason
    : "unknown";
  const status = DEPLOY_TASK_STATUSES.has(snapshot.status)
    ? snapshot.status
    : "running";
  const preserveInternalIdentity =
    options.mode === "persistence" &&
    snapshot.publicProjectionVersion ===
      CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION;
  const retainUnknownPlaceholder = options.mode === "persistence";
  return {
    ...(options.mode === "persistence"
      ? {
          publicProjectionVersion:
            CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION,
        }
      : {}),
    revision:
      Number.isSafeInteger(snapshot.revision) && snapshot.revision >= 0
        ? snapshot.revision
        : 0,
    status,
    steps: (Array.isArray(snapshot.steps) ? snapshot.steps : []).flatMap(
      (step) => {
        const metadata =
          AI_TIMELINE_STEPS[step.id as keyof typeof AI_TIMELINE_STEPS];
        if (metadata == null) {
          return [];
        }
        const stepStatus = TIMELINE_STEP_STATUSES.has(step.status)
          ? step.status
          : "pending";
        const resultCards =
          snapshot.publicProjectionVersion ===
          CURRENT_AI_TIMELINE_PUBLIC_PROJECTION_VERSION
            ? (Array.isArray(step.resultCards) ? step.resultCards : []).flatMap(
                (card, cardIndex) => {
                  const projected = publicAiResultCard({
                    card,
                    failureReason,
                    fallbackCreatedAt,
                    index: cardIndex,
                    preserveInternalIdentity,
                    retainUnknownPlaceholder,
                  });
                  return projected == null ? [] : [projected];
                }
              )
            : [];
        return [
          {
            events: projectAiTimelineEvents({
              events: Array.isArray(step.events) ? step.events : [],
              failureReason,
              fallbackCreatedAt,
              idPrefix: step.id,
              preserveInternalIdentity,
              retainUnknownPlaceholder,
            }),
            id: step.id,
            label: metadata.label,
            order: metadata.order,
            ...(resultCards.length === 0 ? {} : { resultCards }),
            status: stepStatus,
          },
        ];
      }
    ),
    taskId: options.taskId ?? snapshot.taskId,
    updatedAt: fallbackCreatedAt,
  };
}

export function persistableAiDeployTaskTimelineSnapshot(
  snapshot: DeploymentTaskTimelineSnapshot,
  options: {
    failureReason?: unknown;
    taskId?: string;
    updatedAt?: string;
  }
): DeploymentTaskTimelineSnapshot {
  return projectAiDeployTaskTimelineSnapshot(snapshot, {
    ...options,
    mode: "persistence",
  });
}

export function publicDeployTaskTimelineSnapshot(
  snapshot: DeploymentTaskTimelineSnapshot | null,
  options: {
    failureReason?: unknown;
    runner: DeploymentTaskRunner;
    taskId?: string;
    updatedAt?: string;
  }
): DeploymentTaskTimelineSnapshot | null {
  if (snapshot == null || options.runner.kind !== "ai") {
    return snapshot;
  }
  return projectAiDeployTaskTimelineSnapshot(snapshot, {
    failureReason: options.failureReason,
    mode: "public",
    taskId: options.taskId,
    updatedAt: options.updatedAt,
  });
}

function publicAiOutputProgressEventPayload(
  payload: DeployTaskEventPayload
): DeployTaskEventPayload {
  const files = recordValue(payload.files);
  if (
    typeof payload.complete !== "boolean" ||
    files == null ||
    typeof files.buildResult !== "boolean" ||
    typeof files.deliveryManifest !== "boolean" ||
    typeof files.template !== "boolean"
  ) {
    return {};
  }
  return {
    complete: payload.complete,
    files: {
      buildResult: files.buildResult,
      deliveryManifest: files.deliveryManifest,
      template: files.template,
    },
  };
}

function publicAiFailedEventPayload(
  payload: DeployTaskEventPayload
): DeployTaskEventPayload {
  return isDeployTaskFailureReason(payload.reason)
    ? { reason: payload.reason }
    : {};
}

function publicAiEngineResolvedEventPayload(
  payload: DeployTaskEventPayload
): DeployTaskEventPayload {
  const reason = payload.reason;
  const verdict = payload.verdict;
  if (
    !(
      isDeployTaskFailureReason(reason) ||
      (typeof reason === "string" && AI_ENGINE_RESOLUTION_REASONS.has(reason))
    ) ||
    (verdict !== "failed" && verdict !== "cancelled")
  ) {
    return {};
  }
  return { reason, verdict };
}

function publicAiEventPayload(
  payload: DeployTaskEventPayload,
  eventKind: string | undefined
): DeployTaskEventPayload {
  switch (eventKind) {
    case "deployment_task.output_partial":
    case "deployment_task.output_ready":
      return publicAiOutputProgressEventPayload(payload);
    case "deployment_task.failed":
      return publicAiFailedEventPayload(payload);
    case "deployment_task.engine_resolved":
      return publicAiEngineResolvedEventPayload(payload);
    default:
      return {};
  }
}

function publicAiEventMessage(
  eventKind: string,
  payload: DeployTaskEventPayload
): string | null {
  if (eventKind === "deployment_task.failed") {
    return deploymentFailureMessage(
      isDeployTaskFailureReason(payload.reason) ? payload.reason : "unknown"
    );
  }
  if (eventKind === "deployment_task.engine_resolved") {
    if (payload.verdict === "cancelled") {
      return deploymentFailureMessage("cancelled");
    }
    return deploymentFailureMessage(
      isDeployTaskFailureReason(payload.reason) ? payload.reason : "unknown"
    );
  }
  return Object.hasOwn(AI_PUBLIC_EVENT_MESSAGES, eventKind)
    ? AI_PUBLIC_EVENT_MESSAGES[
        eventKind as keyof typeof AI_PUBLIC_EVENT_MESSAGES
      ]
    : null;
}

export function publicDeployTaskEventFields(
  event: {
    kind: string;
    message: string | null;
    payload: DeployTaskEventPayload;
  },
  options: { runner: DeploymentTaskRunner }
): {
  kind: string;
  message: string | null;
  payload: DeployTaskEventPayload;
} {
  if (options.runner.kind !== "ai") {
    return event;
  }
  const isKnownKind =
    event.kind === "deployment_task.engine_resolved" ||
    event.kind === "deployment_task.failed" ||
    Object.hasOwn(AI_PUBLIC_EVENT_MESSAGES, event.kind);
  const payload = publicAiEventPayload(event.payload, event.kind);
  return {
    kind: isKnownKind ? event.kind : "deployment_task.event",
    message: isKnownKind ? publicAiEventMessage(event.kind, payload) : null,
    payload,
  };
}

export function publicDeployTaskGatewayLocator(
  locator: {
    gatewaySessionId: string | null;
    gatewayTurnId: string | null;
    gatewayUrl: string | null;
  },
  options: { runner: DeploymentTaskRunner }
): typeof locator {
  return options.runner.kind === "ai"
    ? {
        gatewaySessionId: null,
        gatewayTurnId: null,
        gatewayUrl: null,
      }
    : locator;
}

export function publicDeployTaskRuntimeLocator(
  locator: {
    runtimeName: string | null;
    runtimeState: string | null;
  },
  options: { runner: DeploymentTaskRunner }
): typeof locator {
  return options.runner.kind === "ai"
    ? { runtimeName: null, runtimeState: null }
    : locator;
}

export function publicDeployTaskEventPayload(
  payload: DeployTaskEventPayload,
  options: { eventKind?: string; runner: DeploymentTaskRunner }
): DeployTaskEventPayload {
  const isAiRunner = options.runner.kind === "ai";
  if (isAiRunner) {
    return publicAiEventPayload(payload, options.eventKind);
  }
  const artifactSummary = recordValue(payload.artifactSummary);
  if (artifactSummary == null) {
    return payload;
  }
  return {
    ...payload,
    artifactSummary: publicDeployTaskArtifactSummary(
      artifactSummary as DeployTaskArtifactSummary,
      { runner: options.runner }
    ),
  };
}
