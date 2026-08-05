import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import type {
  DatabaseDeploymentChoice,
  DatabaseDeploymentSettings,
} from "@/features/deploy/database-deployer";
import { renderDbDeploymentYaml } from "@/features/deploy/db-deployment-yaml";
import { DIRECT_DB_DEPLOYMENT_OPTIONS } from "@/features/deploy/direct-db-deployment-options";
import type { DockerDeploymentSettings } from "@/features/deploy/docker-deployer";
import { validateDockerDeploymentSettings } from "@/features/deploy/docker-deployment-settings";
import { renderDockerDeploymentYaml } from "@/features/deploy/docker-deployment-yaml";
import { getGithubOAuthTokenForDeploymentBinding } from "@/features/deploy/github/connection-service";
import { childResourceName } from "@/features/deploy/project-child-resource-name";
import { applyRenderedTemplateDeployment } from "@/features/deploy/template-k8s-apply";
import {
  deployTemplateInstance,
  getTemplateSource,
} from "@/features/deploy/template-provider-core";
import { normalizeTemplateProviderDbResources } from "@/features/deploy/template-provider-db-labels";
import {
  TemplateInputValidationError,
  templateSourceFromInlineYaml,
} from "@/features/deploy/template-renderer";
import { deriveProjectDisplayName } from "@/features/projects/derived-project-display-name";
import { resolveUserAiProxyCredentials } from "@/lib/ai-proxy/resolve-user-ai-proxy-credentials";
import {
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_PROJECT_ID_LABEL,
  templateDeploymentExtraLabels,
} from "@/lib/brain-labels";
import {
  createDevbox,
  DevboxApiError,
  execDevbox,
  getDevbox,
  listDevboxes,
  pauseDevbox,
  refreshDevboxPause,
  resumeDevbox,
} from "@/lib/devbox/client";
import { getDevboxDefaultImage } from "@/lib/devbox/config";
import type { DevboxInfo } from "@/lib/devbox/types";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import {
  createProject,
  createProjectWithDerivedDisplayName,
  getProject,
  ProjectPersistenceError,
} from "@/lib/project-persistence/projects";

import {
  blockingInputsFromDeploymentPlan,
  createSealosTemplateDeploymentPlan,
  type DeploymentArtifact,
  type DeploymentTemplateInstanceArtifact,
  deployTaskStringRecordValue,
  normalizeBuildResultStatus,
  persistableSealosTemplate,
  prepareBrainManifestArtifact,
  prepareSealosTemplateArtifact,
  sealosTemplateArtifactSummary,
  sealosTemplateInstanceName,
} from "./artifacts";
import { buildRuntimeContract } from "./build-runtime-contract";
import { resolveGithubTokenForDeploymentTask } from "./credential-binding";
import { resultResourceCardsFromArtifactSummary } from "./direct-timeline";
import { isDeployTaskAbortError } from "./engine/errors";
import type { DeployTaskHandle } from "./engine/handle";
import {
  attachDeployFailureDetails,
  attachedDeployFailureDetails,
  attachedDeployFailureReason,
  deployFailureError,
  templateCleanupAllowed,
} from "./failure-details";
import {
  aiFailureReason,
  deploymentFailureReason,
  deployRunnerSurfacesRawFailure,
} from "./failure-summary";
import {
  codexGatewayFailureDetails,
  DEPLOY_GATEWAY_MODEL,
  type GatewayContext,
  getCodexGatewayContextFromDevboxInfo,
  runDeployTaskGateway,
} from "./gateway";
import type { ManagedDeployResumeMode } from "./gateway-prompt";
import {
  assertManagedContractEnvelope,
  assertManagedTurnReportForControl,
  assertManagedVerifyReportForControl,
  buildAtomicJsonWriteCommand,
  buildAtomicStdinWriteCommand,
  buildManagedInputMountProbeCommand,
  buildManagedInputRemovalCommand,
  MANAGED_INPUT_VALUES_MAX_BYTES,
  MANAGED_INPUTS_REQUIRED_MAX_BYTES,
  MANAGED_TURN_REPORT_MAX_BYTES,
  MANAGED_VERIFY_REPORT_MAX_BYTES,
  type ManagedDeploymentControl,
  type ManagedInputsRequired,
  type ManagedTurnReport,
  type ManagedVerifyReport,
  managedTurnOutcomeStartsApplying,
  parseManagedInputMountProbe,
  parseManagedInputsRequired,
  parseManagedTurnReport,
  parseManagedVerifyReport,
  selectManagedInputPath,
} from "./managed-deployment-contract";
import {
  buildManagedResourceDiscoveryCommand,
  buildManagedResourceObservationCommand,
  managedObservedNetworkHosts,
  managedObservedResourceRefs,
  parseManagedResourceDiscovery,
  parseManagedResourceObservations,
  verifyManagedResourceObservations,
} from "./managed-deployment-verifier";
import { deployOutputProgressSummary } from "./output-progress";
import {
  isResultReadinessTerminalError,
  observeDeploymentResultCardReadiness,
  resultReadinessLabel,
  waitingForResultObservationStatus,
} from "./result-readiness";
import {
  deployTaskBeginApplying,
  deployTaskCheckpoint,
  deployTaskComplete,
  deployTaskRequestInputs,
  deployTaskRunSignal,
  recordDeployTaskEvent,
  throwIfDeployTaskAborted,
  updateDeployTaskState,
  updateDeployTaskTimeline,
} from "./runner-writes";
import {
  DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS,
  getDeployDevboxStorageLimitFromEnv,
  getDeploySkillSourceFromEnv,
} from "./runtime-config";
import {
  CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
  CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
  type DeploymentTaskDeploymentPlan,
  type DeployTaskArtifactSummary,
  type DeployTaskBlockingInput,
  type DeployTaskEventPayload,
  type DeployTaskFailureDetails,
  type DeployTaskFailureReason,
  type DeployTaskRow,
} from "./schema";
import {
  artifactSummaryWithScrubbedValues,
  scrubSensitiveJsonValue,
  scrubSensitiveText,
} from "./scrub-secrets";
import {
  allSensitiveArgValues,
  MIN_SENSITIVE_INPUT_LENGTH,
  type SensitiveDeploymentInputShape,
  shortSensitiveArgKeys,
  withoutSensitiveArgs,
} from "./sensitive-inputs";
import { getDeployTaskById, getDeployTaskTimelineSnapshot } from "./service";
import {
  appendCardEvent,
  appendStepEvent,
  applyDeploymentOutputProgressToTimeline,
  applyResultResourceTimeout,
  DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY,
  type DeploymentResultResourceCard,
  deploymentTimelineFailureStepId,
  deploymentTimelineResultReadinessReached,
  markTimelineStep,
  updateTimelineStatus,
  upsertResultResourceCard,
} from "./timeline";
import { deploymentTaskTimelineFromTaskRecord } from "./timeline-storage";
import {
  AGENT_DEPLOY_TIMEOUT_POLICY,
  DEPLOY_TIMEOUT_POLICY,
  deploymentPhaseDeadlineAt,
  deployTaskDeadlineAt,
  remainingDeploymentTimeoutMs,
  remainingDeploymentTimeoutSeconds,
} from "./timeout-policy";
import type {
  DeploymentTaskSource,
  DeploymentTaskTarget,
  DeployTaskTargetResolution,
} from "./types";

const DEPLOY_DEVBOX_NAME_PREFIX = "sealai-deploy";
const DEVBOX_RUNTIME_READY_POLL_MS = 2000;
const DEVBOX_RUNTIME_WAIT_EVENT_MS = 30_000;
const DEVBOX_SECRET_READY_MAX_RETRIES = 3;
const DEVBOX_SECRET_READY_RETRY_DELAY_MS = 2000;
const DEVBOX_SDK_READY_MAX_RETRIES = 90;
const DEVBOX_SDK_READY_RETRY_DELAY_MS = 2000;
const DEVBOX_DEFAULT_MAX_DURATION_MINUTES = 300;
const DEPLOY_WORKSPACE_DIR = "/home/devbox/project";
const DEPLOY_DELIVERY_MANIFEST_PATH = `${DEPLOY_WORKSPACE_DIR}/.sealos/delivery-manifest.json`;
const DEPLOY_BUILD_RESULT_PATH = `${DEPLOY_WORKSPACE_DIR}/.sealos/build-result.json`;
const DEPLOY_BUILD_RUNTIME_PATH = `${DEPLOY_WORKSPACE_DIR}/.sealos/build-runtime.json`;
const DEPLOY_TEMPLATE_YAML_PATH = `${DEPLOY_WORKSPACE_DIR}/.sealos/template/index.yaml`;
const MANAGED_DEPLOYMENT_CONTRACT_DIR = `${DEPLOY_WORKSPACE_DIR}/.sealos/brain`;
const MANAGED_DEPLOYMENT_CONTROL_PATH = `${MANAGED_DEPLOYMENT_CONTRACT_DIR}/control.json`;
const MANAGED_DEPLOYMENT_INPUTS_REQUIRED_PATH = `${MANAGED_DEPLOYMENT_CONTRACT_DIR}/inputs-required.json`;
const MANAGED_DEPLOYMENT_TURN_REPORT_PATH = `${MANAGED_DEPLOYMENT_CONTRACT_DIR}/turn-report.json`;
const MANAGED_DEPLOYMENT_VERIFY_REPORT_PATH = `${MANAGED_DEPLOYMENT_CONTRACT_DIR}/verify-report.json`;
const MANAGED_DEPLOYMENT_BRAIN_REVIEW_PATH = `${MANAGED_DEPLOYMENT_CONTRACT_DIR}/brain-review.json`;
const MANAGED_DEPLOYMENT_BRAIN_REVIEW_RELATIVE_PATH =
  ".sealos/brain/brain-review.json";
const MANAGED_DEPLOYMENT_INPUT_REF_PATH = `${MANAGED_DEPLOYMENT_CONTRACT_DIR}/input-ref.json`;
const MANAGED_DEPLOYMENT_MUTATION_INTENT_RELATIVE_PATH =
  ".sealos/brain/mutation-intent.json";
const MANAGED_DEPLOYMENT_MUTATION_AUTHORIZATION_RELATIVE_PATH =
  ".sealos/brain/mutation-authorized.json";
const MANAGED_DEPLOYMENT_INPUT_ROOT = "/dev/shm/sealai";
const MANAGED_DEPLOYMENT_KUBECONFIG_PATH = "/home/devbox/.kube/config";
const MANAGED_VERIFICATION_QUERY_BATCH_MS = 60_000;
const SKILL_INSTALL_COMMAND_TIMEOUT_SECONDS =
  DEPLOY_TIMEOUT_POLICY.skillInstallMs / 1000;
const DEPLOY_SKILLS_CLI_VERSION = "1.5.20";
const READ_OUTPUT_TIMEOUT_SECONDS = DEPLOY_TIMEOUT_POLICY.outputReadMs / 1000;
const DEPLOY_OUTPUT_PROGRESS_POLL_MS = DEPLOY_TIMEOUT_POLICY.outputPollMs;
const DIRECT_AP_READINESS_POLL_MS = 5000;
const DIRECT_AP_READINESS_DEFAULT_TIMEOUT_MS =
  DEPLOY_TIMEOUT_POLICY.readinessMs;
const APPLY_QUOTA_EXCEEDED_RE = /\bexceeded quota(?::|\b)/i;
const TEMPLATE_CLEANUP_KINDS = [
  "instances",
  "jobs",
  "deployments",
  "statefulsets",
  "services",
  "ingresses",
  "clusters",
  "pods",
  "persistentvolumeclaims",
] as const;

export interface StartDeployTaskRunnerInput {
  /** Authoritative blockers captured immediately before the resume claim. */
  currentBlockingInputs?: readonly DeployTaskBlockingInput[];
  encodedKubeconfig?: string;
  /**
   * Full create-time template args from the credentialed request (ADR
   * 0037): the persisted row holds the stripped copy, so sensitive values
   * only exist here, in process memory, for the launched run.
   */
  sourceArgValues?: Record<string, string>;
  submittedInputValues?: Record<string, unknown>;
  taskId: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sleep that unblocks immediately when the run's abort signal fires. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function combinedAbortSignal(
  ...signals: Array<AbortSignal | undefined>
): AbortSignal | undefined {
  const activeSignals = signals.filter(
    (signal): signal is AbortSignal => signal != null
  );
  if (activeSignals.length === 0) {
    return undefined;
  }
  return activeSignals.length === 1
    ? activeSignals[0]
    : AbortSignal.any(activeSignals);
}

const DEPLOY_SENSITIVE_VALUES_KEY = "__sealaiDeploySensitiveValues";

/**
 * Rides the runner's in-memory known sensitive values up to the single
 * terminal failure write so it can scrub them out of the persisted error
 * (ADR 0042). Never persisted: only the runner holds the plaintext, so this
 * is the only channel to the scrub. AI runs attach nothing.
 */
function attachDeploySensitiveValues(
  error: unknown,
  values: readonly string[]
): unknown {
  if (error instanceof Error && values.length > 0) {
    const carrier = error as Error & {
      [DEPLOY_SENSITIVE_VALUES_KEY]?: string[];
    };
    carrier[DEPLOY_SENSITIVE_VALUES_KEY] = [
      ...(carrier[DEPLOY_SENSITIVE_VALUES_KEY] ?? []),
      ...values,
    ];
  }
  return error;
}

function attachedDeploySensitiveValues(error: unknown): string[] {
  if (error instanceof Error) {
    const carrier = error as Error & {
      [DEPLOY_SENSITIVE_VALUES_KEY]?: string[];
    };
    return carrier[DEPLOY_SENSITIVE_VALUES_KEY] ?? [];
  }
  return [];
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function runtimeHash(input: {
  namespace: string;
  sourceKey: string;
  taskId: string;
}): string {
  return createHash("sha256")
    .update(`${input.namespace}|${input.sourceKey}|${input.taskId}`)
    .digest("hex")
    .slice(0, 32);
}

function runtimeName(hash: string): string {
  return `${DEPLOY_DEVBOX_NAME_PREFIX}-${hash.slice(0, 20)}`;
}

function runtimeUpstreamId(hash: string): string {
  return `${DEPLOY_DEVBOX_NAME_PREFIX}-${hash}`;
}

function getPauseAt(): string {
  return new Date(
    Date.now() + DEVBOX_DEFAULT_MAX_DURATION_MINUTES * 60 * 1000
  ).toISOString();
}

function compactEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function decodeRunnerKubeconfig(encoded: string | undefined): string {
  if (encoded == null || encoded.trim() === "") {
    return "";
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    return "";
  }
}

function requireKubeconfig(input: StartDeployTaskRunnerInput): string {
  const kubeconfig = decodeRunnerKubeconfig(input.encodedKubeconfig);
  if (kubeconfig.trim() === "") {
    throw new Error("Kubeconfig is required to run deployment task.");
  }
  return kubeconfig;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function directApReadinessTimeoutMs(): number {
  const configured = Number(process.env.DIRECT_AP_READINESS_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DIRECT_AP_READINESS_DEFAULT_TIMEOUT_MS;
}

function throwIfDeploymentDeadlineElapsed(
  deadlineAtMs: number,
  reason: DeployTaskFailureReason = "timeout",
  stage?: DeployTaskFailureDetails["stage"]
): void {
  if (remainingDeploymentTimeoutMs({ deadlineAtMs }) <= 0) {
    throw withDeployFailureDetails(deployFailureError(reason), {
      ...(stage == null ? {} : { stage }),
    });
  }
}

function deploymentOperationSignal(input: {
  deadlineAtMs: number;
  reason?: DeployTaskFailureReason;
  stage?: DeployTaskFailureDetails["stage"];
  taskId: string;
}): AbortSignal {
  throwIfDeploymentDeadlineElapsed(
    input.deadlineAtMs,
    input.reason ?? "timeout",
    input.stage
  );
  return AbortSignal.any([
    deployTaskRunSignal(input.taskId),
    AbortSignal.timeout(
      Math.max(
        1,
        remainingDeploymentTimeoutMs({ deadlineAtMs: input.deadlineAtMs })
      )
    ),
  ]);
}

function throwIfDeploymentOperationAborted(input: {
  deadlineAtMs: number;
  reason?: DeployTaskFailureReason;
  signal: AbortSignal;
  stage?: DeployTaskFailureDetails["stage"];
  taskId: string;
}): void {
  throwIfDeployTaskAborted(input.taskId);
  if (input.signal.aborted) {
    throwIfDeploymentDeadlineElapsed(
      input.deadlineAtMs,
      input.reason ?? "timeout",
      input.stage
    );
  }
}

function deploymentExecTimeoutSeconds(input: {
  capMs?: number;
  deadlineAtMs: number;
  reason?: DeployTaskFailureReason;
}): number {
  const timeoutSeconds = remainingDeploymentTimeoutSeconds(input);
  if (timeoutSeconds <= 0) {
    throw deployFailureError(input.reason ?? "timeout");
  }
  return timeoutSeconds;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedStringValue(
  value: unknown,
  path: readonly string[]
): string | null {
  let current: unknown = value;
  for (const key of path) {
    const record = objectValue(current);
    if (record == null) {
      return null;
    }
    current = record[key];
  }
  return stringValue(current);
}

function requiredObjectValue(
  output: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = objectValue(output[key]);
  if (value == null) {
    throw new Error(`Deploy output did not include ${key}.`);
  }
  return value;
}

function requiredStringValue(
  output: Record<string, unknown>,
  key: string
): string {
  const value = stringValue(output[key]);
  if (value == null) {
    throw new Error(`Deploy output did not include ${key}.`);
  }
  return value;
}

function sealosCertSecretName(): string | undefined {
  return (
    compactEnvValue(process.env.AP_USER_DOMAIN_TLS_SECRET_NAME) ??
    compactEnvValue(process.env.SEALOS_CERT_SECRET_NAME) ??
    compactEnvValue(process.env.SEALOS_CERT_SECRET) ??
    undefined
  );
}

function apUserDomain(kubeconfig: string): string {
  return (
    compactEnvValue(process.env.AP_USER_DOMAIN) ??
    routingDomainFromKubeconfig(kubeconfig)
  );
}

function templateDeploymentLabelSelector(input: {
  instanceName: string;
  projectId: string;
}): string {
  return [
    `${BRAIN_PROJECT_ID_LABEL}=${input.projectId}`,
    `${BRAIN_DEPLOYMENT_KIND_LABEL}=template`,
    `${BRAIN_DEPLOYMENT_NAME_LABEL}=${input.instanceName}`,
  ].join(",");
}

function brainProductPath(kind: string): string {
  switch (kind) {
    case "AP":
      return API_ROUTES.ap.root;
    case "DB":
      return API_ROUTES.db.root;
    default:
      throw new Error(
        `Unsupported Brain direct product ${kind || "<missing>"}.`
      );
  }
}

async function applyBrainManifestWithKubeconfig(input: {
  kubeconfig: string;
  signal: AbortSignal;
  taskId: string;
  yaml: string;
}): Promise<string> {
  const YAML = await import("yaml");
  const docs = YAML.parseAllDocuments(input.yaml)
    .map((doc) => doc.toJS())
    .filter((doc) => doc != null);
  if (docs.length === 0) {
    throw new Error("Brain product manifest is empty.");
  }
  const header = {
    Authorization: `Bearer ${encodeURIComponent(input.kubeconfig)}`,
    "Content-Type": "application/json",
  };
  for (const doc of docs) {
    // The direct runner stops between resource applications (ADR 0038): a
    // cancel observed here leaves later documents unapplied.
    throwIfDeployTaskAborted(input.taskId);
    if (doc == null || typeof doc !== "object" || Array.isArray(doc)) {
      throw new Error("Brain product manifest must be a YAML object.");
    }
    const record = doc as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    await fetcher({
      base: ApiUrl(),
      body: { yaml: YAML.stringify(doc).trimEnd() },
      header,
      method: "PUT",
      path: brainProductPath(kind),
      signal: input.signal,
    });
  }
  return `Applied ${docs.length} Brain direct resource${docs.length === 1 ? "" : "s"}.`;
}

async function deleteTemplateResourcesBySelector(input: {
  encodedKubeconfig: string;
  kind: string;
  labelSelector: string;
  namespace: string;
}): Promise<void> {
  await fetcher({
    base: ApiUrl(),
    header: {
      Authorization: kubeconfigBearerHeader(input.encodedKubeconfig),
    },
    method: "DELETE",
    path: API_ROUTES.k8s.delete,
    query: {
      kind: input.kind,
      "label-selector": input.labelSelector,
      namespace: input.namespace,
    },
  });
}

async function getDevboxNetworkIdFromKubernetes(input: {
  encodedKubeconfig: string;
  name: string;
  namespace: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const result = await fetcher<unknown>({
    base: ApiUrl(),
    header: {
      Authorization: kubeconfigBearerHeader(input.encodedKubeconfig),
    },
    method: "GET",
    path: API_ROUTES.k8s.get,
    query: {
      kind: "devboxes",
      name: input.name,
      namespace: input.namespace,
    },
    signal: input.signal,
  });
  return nestedStringValue(result, ["status", "network", "uniqueID"]);
}

async function applyDeploymentArtifact(input: {
  artifact: DeploymentArtifact;
  githubToken?: string;
  kubeconfig: string;
  signal: AbortSignal;
  task: DeployTaskRow;
}): Promise<{
  artifactSummary: DeployTaskArtifactSummary;
  notes: string;
}> {
  if (input.artifact.kind === "template-instance-pending") {
    // The instance is created HERE, inside create-resources — not during
    // prepare-template — so a provider/K8s creation failure is attributed to
    // the step that owns creation. `input.kubeconfig` is the decoded
    // kubeconfig; `headerSafeEncodedKubeconfig` (inside deployTemplateInstance)
    // normalizes raw or URL-encoded input alike.
    const deployed = await deployTemplateInstance({
      args: input.artifact.args,
      encodedKubeconfig: input.kubeconfig,
      extraLabels: input.artifact.extraLabels,
      instanceName: input.artifact.instanceName,
      signal: input.signal,
      templateName: input.artifact.templateName,
    });
    await normalizeTemplateProviderDbResources({
      encodedKubeconfig: input.kubeconfig,
      instanceName: deployed.instanceName,
      namespace: input.task.namespace,
      projectId: input.task.projectId ?? deployed.instanceName,
      resources: deployed.resources,
      signal: input.signal,
      templateName: input.artifact.templateName,
    });
    const created: DeploymentTemplateInstanceArtifact = {
      instanceName: deployed.instanceName,
      kind: "template-instance",
      resources: deployed.resources,
      templateName: input.artifact.templateName,
    };
    return {
      artifactSummary: {
        artifacts: [created],
        resources: created.resources.map((resource) => ({
          apiVersion: "template.sealos.io",
          kind: resource.resourceType,
          name: resource.name,
          namespace: input.task.namespace,
        })),
      },
      notes: `Deployed template instance ${created.instanceName}.`,
    };
  }

  if (input.artifact.kind === "template-instance") {
    return {
      artifactSummary: {
        artifacts: [input.artifact],
        resources: input.artifact.resources.map((resource) => ({
          apiVersion: "template.sealos.io",
          kind: resource.resourceType,
          name: resource.name,
          namespace: input.task.namespace,
        })),
      },
      notes: `Deployed template instance ${input.artifact.instanceName}.`,
    };
  }

  if (input.artifact.kind === "sealos-template") {
    const applied = await applyRenderedTemplateDeployment({
      encodedKubeconfig: input.kubeconfig,
      namespace: input.task.namespace,
      projectId: input.task.projectId ?? input.artifact.instanceName,
      registryAuth:
        input.githubToken == null
          ? undefined
          : {
              buildDigest: input.artifact.build.digest,
              buildImage: input.artifact.build.image,
              githubToken: input.githubToken,
            },
      rendered: input.artifact.rendered,
      signal: input.signal,
      templateName: input.artifact.templateName,
    });
    return {
      artifactSummary: sealosTemplateArtifactSummary({
        appliedResources: applied.resources,
        artifact: input.artifact,
        notes: `Deployed Sealos template ${applied.instanceName}.`,
      }),
      notes: `Deployed Sealos template ${applied.instanceName}.`,
    };
  }

  const prepared = prepareBrainManifestArtifact({
    artifact: input.artifact,
    task: input.task,
  });
  const notes = await applyBrainManifestWithKubeconfig({
    kubeconfig: input.kubeconfig,
    signal: input.signal,
    taskId: input.task.id,
    yaml: prepared.yaml,
  });
  return {
    artifactSummary: {
      artifacts: [input.artifact],
      resources: prepared.resources,
      resourceYamls: [prepared.yaml],
    },
    notes,
  };
}

function timelineEvent(input: {
  dedupeKey?: string;
  message: string;
  reason?: string;
  severity?: "info" | "success" | "warning" | "error";
  source?: "runner" | "resource-observer" | "kubernetes-event" | "health-check";
}) {
  return {
    createdAt: new Date().toISOString(),
    dedupeKey: input.dedupeKey,
    id: randomUUID(),
    message: input.message,
    reason: input.reason,
    severity: input.severity,
    source: input.source,
  };
}

async function markTimelineStepWithEvent(input: {
  eventKind: string;
  eventMessage: string;
  eventPayload?: DeployTaskEventPayload;
  eventReason?: string;
  eventSeverity?: "info" | "success" | "warning" | "error";
  phase: DeployTaskRow["phase"];
  status: Parameters<typeof markTimelineStep>[1]["status"];
  stepId: string;
  taskId: string;
  timelineDedupeKey?: string;
  timelineStatus?: DeployTaskRow["status"];
}) {
  const now = new Date().toISOString();
  await updateDeployTaskTimeline(input.taskId, {
    event: {
      kind: input.eventKind,
      message: input.eventMessage,
      payload: input.eventPayload,
      phase: input.phase,
    },
    update: (timeline) =>
      appendStepEvent(
        markTimelineStep(
          input.timelineStatus == null
            ? timeline
            : updateTimelineStatus(timeline, {
                status: input.timelineStatus,
                updatedAt: now,
              }),
          {
            status: input.status,
            stepId: input.stepId,
            updatedAt: now,
          }
        ),
        {
          event: timelineEvent({
            dedupeKey: input.timelineDedupeKey ?? input.eventKind,
            message: input.eventMessage,
            reason: input.eventReason,
            severity: input.eventSeverity,
            source: "runner",
          }),
          stepId: input.stepId,
          updatedAt: now,
        }
      ),
  });
}

async function markDeployTaskFailureTimeline(input: {
  detailMessage: string;
  reasonMessage: string;
  task: DeployTaskRow;
}): Promise<boolean> {
  const timeline = deploymentTaskTimelineFromTaskRecord(input.task);
  const stepId = deploymentTimelineFailureStepId({
    phase: input.task.phase,
    runner: input.task.runner,
    timeline,
  });
  if (stepId == null) {
    return false;
  }

  await markTimelineStepWithEvent({
    eventKind: "deployment_task.failed",
    eventMessage: input.reasonMessage,
    eventPayload: deployRunnerSurfacesRawFailure(input.task.runner)
      ? { error: input.detailMessage }
      : {},
    eventReason: "DeploymentTaskFailed",
    eventSeverity: "error",
    phase: input.task.phase,
    status: "failed",
    stepId,
    taskId: input.task.id,
    timelineDedupeKey: DEPLOYMENT_TASK_TERMINAL_FAILURE_EVENT_KEY,
    timelineStatus: "failed",
  });
  return true;
}

async function upsertResultTimelineCard(input: {
  card: DeploymentResultResourceCard;
  eventMessage: string;
  eventReason: string;
  eventSeverity?: "info" | "success" | "warning" | "error";
  taskId: string;
}) {
  const now = new Date().toISOString();
  await updateDeployTaskTimeline(input.taskId, {
    event: {
      kind: "deployment_task.result_resource_observed",
      message: input.eventMessage,
      phase: "apply",
      payload: {
        cardId: input.card.id,
        latestStatusText: input.card.latestStatusText,
        resultRef: input.card.resultRef,
        status: input.card.status,
      },
    },
    update: (timeline) =>
      appendCardEvent(
        upsertResultResourceCard(timeline, {
          card: input.card,
          stepId: "create-resources",
          updatedAt: now,
        }),
        {
          cardId: input.card.id,
          event: timelineEvent({
            dedupeKey: `${input.card.id}:${input.card.status}:${input.card.latestStatusText ?? ""}`,
            message: input.eventMessage,
            reason: input.eventReason,
            severity: input.eventSeverity,
            source: "resource-observer",
          }),
          stepId: "create-resources",
          updatedAt: now,
        }
      ),
  });
}

async function observeResultCardReadiness(input: {
  card: DeploymentResultResourceCard;
  kubeconfig: string;
  previousLatestStatus: string | undefined;
  previousStatus: DeploymentResultResourceCard["status"] | undefined;
  signal: AbortSignal;
  surfaceObservationError: boolean;
  taskId: string;
}): Promise<{
  latestStatus: string;
  running: boolean;
  status: DeploymentResultResourceCard["status"];
}> {
  try {
    const observed = await observeDeploymentResultCardReadiness({
      card: input.card,
      kubeconfig: input.kubeconfig,
      signal: input.signal,
      surfaceObservationError: input.surfaceObservationError,
    });
    // Only write when the observed state changed. An identical re-observation
    // would still bump the timeline revision and NOTIFY every stream client,
    // waking the whole timeline pane to re-render for nothing; with a poll
    // every DIRECT_AP_READINESS_POLL_MS, that is what makes a resource sitting
    // at e.g. 0/1 pulse the UI each cycle.
    if (
      observed.status !== input.previousStatus ||
      observed.latestStatus !== input.previousLatestStatus
    ) {
      await upsertResultTimelineCard({
        card: observed.card,
        eventMessage: observed.eventMessage,
        eventReason: observed.eventReason,
        eventSeverity: observed.eventSeverity,
        taskId: input.taskId,
      });
    }

    if (input.card.required && observed.status === "failed") {
      throw new Error(`${resultReadinessLabel(input.card)} failed readiness.`);
    }
    if (input.card.required && observed.status === "blocked") {
      throw new Error(
        `${resultReadinessLabel(input.card)} readiness is blocked.`
      );
    }
    return {
      latestStatus: observed.latestStatus,
      running: observed.running,
      status: observed.status,
    };
  } catch (error) {
    if (isResultReadinessTerminalError(error)) {
      throw error;
    }
    return {
      latestStatus: waitingForResultObservationStatus(input.card, error, {
        surfaceObservationError: input.surfaceObservationError,
      }),
      running: !input.card.required,
      status: "unknown",
    };
  }
}

async function observeResultCardBeforeDeadline(input: {
  card: DeploymentResultResourceCard;
  deadlineAtMs: number;
  kubeconfig: string;
  previousLatestStatus: string | undefined;
  previousStatus: DeploymentResultResourceCard["status"] | undefined;
  surfaceObservationError: boolean;
  taskId: string;
}): Promise<Awaited<ReturnType<typeof observeResultCardReadiness>> | null> {
  try {
    const signal = deploymentOperationSignal({
      deadlineAtMs: input.deadlineAtMs,
      reason: "readiness-timeout",
      stage: "readiness",
      taskId: input.taskId,
    });
    return await observeResultCardReadiness({
      ...input,
      signal,
    });
  } catch (error) {
    throwIfDeployTaskAborted(input.taskId);
    if (
      remainingDeploymentTimeoutMs({
        deadlineAtMs: input.deadlineAtMs,
      }) <= 0
    ) {
      return null;
    }
    throw error;
  }
}

async function waitForRequiredResultCards(input: {
  cards: DeploymentResultResourceCard[];
  deadlineAtMs?: number;
  kubeconfig: string;
  surfaceObservationError: boolean;
  taskId: string;
}): Promise<void> {
  const startedAt = Date.now();
  const timeoutMs = directApReadinessTimeoutMs();
  const deadlineAtMs = Math.min(
    startedAt + timeoutMs,
    input.deadlineAtMs ?? Number.POSITIVE_INFINITY
  );
  let latestStatus = "waiting for required result resource observation";
  const latestStatusByCard = new Map<string, string>();
  const statusByCard = new Map<
    string,
    DeploymentResultResourceCard["status"]
  >();

  readinessLoop: while (Date.now() < deadlineAtMs) {
    // Cancel means "stop waiting" during verify (ADR 0038).
    await deployTaskCheckpoint(input.taskId);
    let requiredCardsRunning = true;

    for (const card of input.cards) {
      const observed = await observeResultCardBeforeDeadline({
        card,
        deadlineAtMs,
        kubeconfig: input.kubeconfig,
        previousLatestStatus: latestStatusByCard.get(card.id),
        previousStatus: statusByCard.get(card.id),
        surfaceObservationError: input.surfaceObservationError,
        taskId: input.taskId,
      });
      if (observed == null) {
        break readinessLoop;
      }
      latestStatus = observed.latestStatus;
      latestStatusByCard.set(card.id, observed.latestStatus);
      statusByCard.set(card.id, observed.status);
      if (card.required) {
        requiredCardsRunning = requiredCardsRunning && observed.running;
      }
    }

    if (requiredCardsRunning) {
      const snapshot = await getDeployTaskTimelineSnapshot(input.taskId);
      if (
        snapshot == null ||
        deploymentTimelineResultReadinessReached(snapshot.timeline)
      ) {
        return;
      }
    }

    await abortableSleep(
      Math.min(
        DIRECT_AP_READINESS_POLL_MS,
        Math.max(0, deadlineAtMs - Date.now())
      ),
      deployTaskRunSignal(input.taskId)
    );
  }

  const now = new Date().toISOString();
  const unresolvedCards = input.cards.filter(
    (card) => (statusByCard.get(card.id) ?? card.status) !== "running"
  );
  for (const card of unresolvedCards) {
    await updateDeployTaskTimeline(input.taskId, {
      event: {
        kind: "deployment_task.result_resource_timeout",
        message: `${resultReadinessLabel(card)} did not reach readiness before timeout.`,
        phase: "apply",
        payload: {
          cardId: card.id,
          lastObservedStatus: latestStatusByCard.get(card.id) ?? latestStatus,
          required: card.required,
          resultRef: card.resultRef,
        },
      },
      update: (timeline) =>
        applyResultResourceTimeout(timeline, {
          cardId: card.id,
          failRequired: true,
          lastObservedStatus: latestStatusByCard.get(card.id) ?? latestStatus,
          stepId: "create-resources",
          updatedAt: now,
        }),
    });
  }

  throw attachDeployFailureDetails(
    new Error(
      `Timed out waiting for required result resource readiness (${latestStatus}).`
    ),
    { reason: "readiness-timeout", stage: "readiness" }
  );
}

export interface CodexGatewayOpenAiCredentials {
  apiKey: string;
  baseUrl: string;
}

export function buildCodexGatewayEnv(
  credentials?: CodexGatewayOpenAiCredentials
): Record<string, string> {
  const env: Record<string, string> = {};
  const apiKey = credentials
    ? credentials.apiKey
    : (compactEnvValue(process.env.CODEX_GATEWAY_OPENAI_API_KEY) ??
      compactEnvValue(process.env.SYSTEM_OPENAI_API_KEY));
  const baseUrl = credentials
    ? credentials.baseUrl
    : (compactEnvValue(process.env.CODEX_GATEWAY_OPENAI_BASE_URL) ??
      compactEnvValue(process.env.SYSTEM_OPENAI_API_BASE_URL));
  const model =
    compactEnvValue(process.env.CODEX_GATEWAY_MODEL) ?? DEPLOY_GATEWAY_MODEL;

  if (apiKey != null) {
    env.CODEX_GATEWAY_OPENAI_API_KEY = apiKey;
  }
  if (baseUrl != null) {
    env.CODEX_GATEWAY_OPENAI_BASE_URL = baseUrl;
  }
  if (model != null) {
    env.CODEX_GATEWAY_MODEL = model;
  }

  return env;
}

export async function resolveGithubCodexGatewayCredentials(input: {
  encodedKubeconfig: string;
  kubeconfig: string;
  signal?: AbortSignal;
}): Promise<CodexGatewayOpenAiCredentials> {
  const resolved = await resolveUserAiProxyCredentials({
    encodedKubeconfig: input.encodedKubeconfig,
    kubeconfigText: input.kubeconfig,
    signal: input.signal,
  });
  if (!resolved.ok) {
    if (resolved.reason === "missing-kubeconfig") {
      throw new Error(
        "GitHub deployment requires a kubeconfig credential for AI Proxy."
      );
    }
    if (resolved.reason === "invalid-kubeconfig") {
      throw new Error(
        "Could not read the Kubernetes API server hostname required for GitHub deployment AI Proxy."
      );
    }
    throw new Error(
      `Could not obtain the user's AI Proxy key for GitHub deployment (HTTP ${resolved.status}).`
    );
  }

  return {
    apiKey: resolved.credentials.apiKey,
    baseUrl: resolved.credentials.baseUrl,
  };
}

function isDevboxSecretPendingError(error: unknown): error is DevboxApiError {
  return (
    error instanceof DevboxApiError &&
    error.status >= 500 &&
    error.message.includes("get devbox private key failed") &&
    error.message.includes("not found")
  );
}

function isDevboxSdkPendingError(error: unknown): error is DevboxApiError {
  if (!(error instanceof DevboxApiError) || error.status < 500) {
    return false;
  }

  const message = error.message;
  return (
    (message.includes("sdk server") &&
      message.includes("is not reachable yet")) ||
    (message.includes("exec command failed") &&
      message.includes(":9757") &&
      message.includes("connect: connection refused"))
  );
}

type ResolvableDeploymentTaskTarget = Pick<
  DeployTaskRow,
  "id" | "namespace" | "projectId" | "projectName" | "source" | "target"
>;

function deployFailureDetails(input: {
  error: unknown;
  phase: DeployTaskRow["phase"];
  source: string;
  task: DeployTaskRow;
}): DeployTaskFailureDetails {
  return {
    errorMessage:
      input.error instanceof Error ? input.error.message : String(input.error),
    errorName: input.error instanceof Error ? input.error.name : null,
    phase: input.phase,
    projectId: input.task.projectId,
    projectName: input.task.projectName,
    runner: input.task.runner,
    source: input.source,
    taskId: input.task.id,
    timestamp: new Date().toISOString(),
  };
}

function withDeployFailureDetails(
  error: unknown,
  details: DeployTaskFailureDetails
): Error {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const existingReason = attachedDeployFailureReason(normalized);
  return attachDeployFailureDetails(normalized, {
    ...details,
    ...(existingReason == null ? {} : { reason: existingReason }),
  }) as Error;
}

async function runWithDeployFailureDetails<T>(
  details: DeployTaskFailureDetails,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw withDeployFailureDetails(error, details);
  }
}

function applyFailureReason(error: unknown): DeployTaskFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  // This classifier runs only on the provider/Kubernetes apply boundary, not
  // arbitrary AI/Gateway output (ADR 0042).
  return APPLY_QUOTA_EXCEEDED_RE.test(message)
    ? "quota-exceeded"
    : "apply-failed";
}

/**
 * Resolves (or creates) the Deployment Target Project. Pure with respect to
 * task state: creation calls it before inserting the row so the response and
 * the stored row carry the resolved Project identity from the start
 * (ADR 0023 — cached on the task, never re-created).
 */
export async function resolveDeploymentTaskTarget(
  task: ResolvableDeploymentTaskTarget
): Promise<{
  createdProject: boolean;
  projectId: string;
  projectName: string;
}> {
  const cachedProjectId = task.projectId?.trim();
  const cachedProjectName = task.projectName?.trim();
  if (cachedProjectId && cachedProjectName) {
    return {
      createdProject: false,
      projectId: cachedProjectId,
      projectName: cachedProjectName,
    };
  }

  if (task.target.kind === "newProject") {
    const displayName = task.target.displayName?.trim();
    // Two channels, no third mode (ADR 0058): an absent name is derived from
    // the Deployment Source and suffixed on collision; a supplied one is used
    // verbatim and a collision surfaces as a conflict.
    const project = displayName
      ? await createProject({
          description: task.target.description,
          displayName,
          namespace: task.namespace,
        })
      : await createProjectWithDerivedDisplayName({
          derivedDisplayName: deriveProjectDisplayName(task.source),
          description: task.target.description,
          namespace: task.namespace,
        });
    return {
      createdProject: true,
      projectId: project.id,
      projectName: project.id,
    };
  }

  const project = await getProject(task.namespace, task.target.projectId);
  if (project == null) {
    throw new Error("Project not found.");
  }
  const projectName = task.target.projectName?.trim() || project.id;
  return {
    createdProject: false,
    projectId: project.id,
    projectName,
  };
}

/**
 * Creation-time wrapper shared by every entry point that opens a Deployment
 * Task, so a caller-chosen Project Display Name that is already taken becomes a
 * reportable conflict rather than an unhandled failure (ADR 0058).
 */
export async function resolveDeployTaskTargetForCreate(input: {
  namespace: string;
  source: DeploymentTaskSource;
  target: DeploymentTaskTarget;
}): Promise<DeployTaskTargetResolution> {
  const explicitDisplayName =
    input.target.kind === "newProject"
      ? input.target.displayName?.trim()
      : undefined;
  try {
    const resolved = await resolveDeploymentTaskTarget({
      id: "",
      namespace: input.namespace,
      projectId: null,
      projectName: null,
      source: input.source,
      target: input.target,
    });
    return {
      kind: "resolved",
      projectId: resolved.projectId,
      projectName: resolved.projectName,
    };
  } catch (error) {
    if (
      explicitDisplayName &&
      error instanceof ProjectPersistenceError &&
      error.code === "conflict"
    ) {
      return {
        displayName: explicitDisplayName,
        kind: "project-name-conflict",
      };
    }
    throw error;
  }
}

function databaseChoice(databaseId: string): DatabaseDeploymentChoice {
  const choice = DIRECT_DB_DEPLOYMENT_OPTIONS.find(
    (option) => option.id === databaseId
  );
  if (choice == null) {
    throw new Error("Choose a database engine.");
  }
  return choice;
}

function dockerSettings(sourceSettings: Record<string, unknown>) {
  const settings = sourceSettings as unknown as DockerDeploymentSettings;
  const validation = validateDockerDeploymentSettings(settings);
  if (!validation.valid) {
    throw new Error(
      validation.errors[0]?.message ?? "Docker deployment settings are invalid."
    );
  }
  return settings;
}

function databaseSettings(
  sourceSettings: Record<string, unknown>
): DatabaseDeploymentSettings {
  const settings = sourceSettings as unknown as DatabaseDeploymentSettings;
  if (!settings.databaseId?.trim()) {
    throw new Error("Choose a database engine.");
  }
  if (!settings.instancePreset) {
    throw new Error("Choose a database resource preset.");
  }
  if (!Number.isFinite(settings.replicas)) {
    throw new Error("Choose database replicas.");
  }
  return settings;
}

function generateDirectArtifact(input: {
  kubeconfig: string;
  projectName: string;
  task: DeployTaskRow;
}): DeploymentArtifact {
  switch (input.task.source.kind) {
    case "docker": {
      const settings = dockerSettings(input.task.source.settings);
      return {
        kind: "brain-manifest",
        yaml: renderDockerDeploymentYaml({
          name: childResourceName(input.projectName, "ap"),
          namespace: input.task.namespace,
          projectName: input.projectName,
          routingDomain: apUserDomain(input.kubeconfig),
          settings,
        }),
      };
    }
    case "database": {
      const settings = databaseSettings(input.task.source.settings);
      const choice = databaseChoice(settings.databaseId);
      return {
        kind: "brain-manifest",
        yaml: renderDbDeploymentYaml({
          engine: choice.engine,
          name: childResourceName(input.projectName, "db"),
          namespace: input.task.namespace,
          projectName: input.projectName,
          quota: settings.instancePreset,
          replicas: settings.replicas,
          template: choice.template ?? choice.id,
        }),
      };
    }
    default:
      throw new Error(
        `Direct runner does not support ${input.task.source.kind} deployments.`
      );
  }
}

function generateTemplateArtifact(input: {
  /** Full args, memory-merged — never read from the stripped row copy. */
  args: Record<string, string>;
  instanceName: string;
  namespace: string;
  projectId: string;
  templateName: string;
}): DeploymentArtifact {
  // Only assemble the in-memory intent here. The provider POST that creates
  // the instance runs later, inside create-resources (applyDeploymentArtifact),
  // so a creation failure is attributed to the step that owns it. These args
  // are sensitive (ADR 0037) and ride only in this intent — never persisted.
  return {
    args: input.args,
    extraLabels: templateDeploymentExtraLabels({
      instanceName: input.instanceName,
      projectId: input.projectId,
      templateName: input.templateName,
    }),
    instanceName: input.instanceName,
    kind: "template-instance-pending",
    templateName: input.templateName,
  };
}

async function cleanupFailedTemplateDeployment(input: {
  encodedKubeconfig: string;
  instanceName: string;
  projectId: string;
  task: DeployTaskRow;
}): Promise<void> {
  const labelSelector = templateDeploymentLabelSelector({
    instanceName: input.instanceName,
    projectId: input.projectId,
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.template_cleanup_started",
    message: `Cleaning up partial template resources for ${input.instanceName}.`,
    payload: { instanceName: input.instanceName, labelSelector },
    phase: "plan",
  });

  const results: Array<{ error?: string; kind: string; ok: boolean }> = [];
  for (const kind of TEMPLATE_CLEANUP_KINDS) {
    try {
      await deleteTemplateResourcesBySelector({
        encodedKubeconfig: input.encodedKubeconfig,
        kind,
        labelSelector,
        namespace: input.task.namespace,
      });
      results.push({ kind, ok: true });
    } catch (error) {
      results.push(
        input.task.runner.kind === "ai"
          ? { kind, ok: false }
          : { error: errorMessage(error), kind, ok: false }
      );
    }
  }

  const failures = results.filter((result) => !result.ok);
  await recordDeployTaskEvent(input.task.id, {
    kind:
      failures.length === 0
        ? "deployment_task.template_cleanup_completed"
        : "deployment_task.template_cleanup_failed",
    message:
      failures.length === 0
        ? "Cleaned up partial template resources."
        : `Template cleanup completed with ${failures.length} failed kind(s).`,
    payload: {
      failures,
      instanceName: input.instanceName,
      labelSelector,
      results,
    },
    phase: "plan",
  });
}

function isDevboxRuntimePendingError(error: unknown): error is DevboxApiError {
  return (
    error instanceof DevboxApiError &&
    (error.status === 404 || error.status >= 500)
  );
}

async function getDevboxWithSecretRetry(
  authNamespace: string,
  name: string,
  signal?: AbortSignal
): Promise<DevboxInfo> {
  let attempt = 0;

  while (true) {
    try {
      return (await getDevbox(authNamespace, name, signal)).data;
    } catch (error) {
      signal?.throwIfAborted();
      if (
        !isDevboxSecretPendingError(error) ||
        attempt >= DEVBOX_SECRET_READY_MAX_RETRIES
      ) {
        throw error;
      }
      attempt += 1;
      if (signal == null) {
        await sleep(DEVBOX_SECRET_READY_RETRY_DELAY_MS);
      } else {
        await abortableSleep(DEVBOX_SECRET_READY_RETRY_DELAY_MS, signal);
        signal.throwIfAborted();
      }
    }
  }
}

async function waitForRunningDevbox(input: {
  deadlineAtMs?: number;
  name: string;
  namespace: string;
  signal?: AbortSignal;
  taskId?: string;
}): Promise<DevboxInfo> {
  const startedAt = Date.now();
  const deadlineAtMs = Math.min(
    startedAt + DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS,
    input.deadlineAtMs ?? Number.POSITIVE_INFINITY
  );
  let lastEventAt = startedAt;

  while (Date.now() < deadlineAtMs) {
    input.signal?.throwIfAborted();
    try {
      const info = await getDevboxWithSecretRetry(
        input.namespace,
        input.name,
        input.signal
      );
      if (info.state.phase === "Running") {
        return info;
      }
    } catch (error) {
      input.signal?.throwIfAborted();
      if (!isDevboxRuntimePendingError(error)) {
        throw error;
      }
    }

    const now = Date.now();
    if (
      input.taskId != null &&
      now - lastEventAt >= DEVBOX_RUNTIME_WAIT_EVENT_MS
    ) {
      lastEventAt = now;
      const elapsedSeconds = Math.round((now - startedAt) / 1000);
      await updateDeployTaskState(input.taskId, {
        runtimeName: input.name,
        runtimeProvider: "devbox",
        runtimeState: "waiting",
      });
      await recordDeployTaskEvent(input.taskId, {
        kind: "deployment_task.runtime_waiting",
        message: `Still waiting for deploy Devbox runtime (${elapsedSeconds}s).`,
        payload: { elapsedSeconds },
        phase: "prepare",
      });
    }
    if (input.signal != null) {
      await abortableSleep(DEVBOX_RUNTIME_READY_POLL_MS, input.signal);
      input.signal.throwIfAborted();
    } else if (input.taskId == null) {
      await sleep(DEVBOX_RUNTIME_READY_POLL_MS);
    } else {
      throwIfDeployTaskAborted(input.taskId);
      await abortableSleep(
        DEVBOX_RUNTIME_READY_POLL_MS,
        deployTaskRunSignal(input.taskId)
      );
    }
  }

  throw withDeployFailureDetails(
    new Error(
      `Timed out waiting for deploy Devbox runtime after ${Math.round(
        (deadlineAtMs - startedAt) / 1000
      )}s.`
    ),
    { reason: "timeout" }
  );
}

async function ensureRunningDevbox(
  authNamespace: string,
  name: string,
  taskId?: string,
  deadlineAtMs?: number,
  signal?: AbortSignal
): Promise<DevboxInfo> {
  const info = await getDevboxWithSecretRetry(authNamespace, name, signal);
  if (info.state.phase === "Running") {
    return info;
  }

  try {
    await resumeDevbox(authNamespace, name, signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (!(error instanceof DevboxApiError && error.status === 409)) {
      throw error;
    }
  }

  return await waitForRunningDevbox({
    deadlineAtMs,
    name,
    namespace: authNamespace,
    signal,
    taskId,
  });
}

function authenticatedRepoUrl(repoUrl: string, githubToken?: string): string {
  if (!githubToken?.trim()) {
    return repoUrl;
  }
  const url = new URL(repoUrl);
  if (url.hostname !== "github.com") {
    return repoUrl;
  }
  url.username = "x-access-token";
  url.password = githubToken.trim();
  return url.toString();
}

function cloneWorkspaceCommand(input: {
  branch: string | null;
  githubToken?: string;
  repoUrl: string;
}): string {
  const repo = authenticatedRepoUrl(input.repoUrl, input.githubToken);
  const branch = input.branch?.trim();
  const cloneLine = branch
    ? `git clone --depth 1 --branch ${shellQuote(branch)} ${shellQuote(repo)} "$tmpdir/repo"`
    : `git clone --depth 1 ${shellQuote(repo)} "$tmpdir/repo"`;
  return [
    "set -euo pipefail",
    `workspace_dir=${shellQuote(DEPLOY_WORKSPACE_DIR)}`,
    'mkdir -p "$workspace_dir"',
    'if [ ! -d "$workspace_dir/.git" ]; then',
    '  tmpdir="$(mktemp -d)"',
    '  cleanup() { rm -rf "$tmpdir"; }',
    "  trap cleanup EXIT",
    `  ${cloneLine}`,
    '  find "$workspace_dir" -mindepth 1 -maxdepth 1 -exec rm -rf {} +',
    '  cp -a "$tmpdir/repo"/. "$workspace_dir"/',
    "fi",
    "if id devbox >/dev/null 2>&1; then",
    '  if [ "$(id -u)" = "0" ]; then',
    '    chown -R devbox:devbox "$workspace_dir"',
    "  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then",
    '    sudo chown -R devbox:devbox "$workspace_dir"',
    "  fi",
    "fi",
  ].join("\n");
}

function prepareWorkspaceOutputCommand(): string {
  return [
    "set -euo pipefail",
    `workspace_dir=${shellQuote(DEPLOY_WORKSPACE_DIR)}`,
    'mkdir -p "$workspace_dir/.sealos/template"',
    'rm -f "$workspace_dir/.sealos/delivery-manifest.json"',
    'rm -f "$workspace_dir/.sealos/build-result.json"',
    `rm -f ${shellQuote(DEPLOY_BUILD_RUNTIME_PATH)}`,
    'rm -f "$workspace_dir/.sealos/template/index.yaml"',
    "if id devbox >/dev/null 2>&1; then",
    '  if [ "$(id -u)" = "0" ]; then',
    '    chown -R devbox:devbox "$workspace_dir/.sealos"',
    "  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then",
    '    sudo chown -R devbox:devbox "$workspace_dir/.sealos"',
    "  fi",
    "fi",
  ].join("\n");
}

function writeBuildRuntimeContractCommand(
  contract: Record<string, unknown>
): string {
  return [
    "set -euo pipefail",
    `workspace_dir=${shellQuote(DEPLOY_WORKSPACE_DIR)}`,
    'mkdir -p "$workspace_dir/.sealos"',
    `cat > ${shellQuote(DEPLOY_BUILD_RUNTIME_PATH)} <<'EOF'`,
    JSON.stringify(contract, null, 2),
    "EOF",
    "if id devbox >/dev/null 2>&1; then",
    '  if [ "$(id -u)" = "0" ]; then',
    `    chown devbox:devbox ${shellQuote(DEPLOY_BUILD_RUNTIME_PATH)}`,
    "  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then",
    `    sudo chown devbox:devbox ${shellQuote(DEPLOY_BUILD_RUNTIME_PATH)}`,
    "  fi",
    "fi",
  ].join("\n");
}

function prepareEmptyWorkspaceCommand(): string {
  return [
    "set -euo pipefail",
    `workspace_dir=${shellQuote(DEPLOY_WORKSPACE_DIR)}`,
    'mkdir -p "$workspace_dir"',
    'find "$workspace_dir" -mindepth 1 -maxdepth 1 -exec rm -rf {} +',
    'mkdir -p "$workspace_dir/.sealos/template"',
    "if id devbox >/dev/null 2>&1; then",
    '  if [ "$(id -u)" = "0" ]; then',
    '    chown -R devbox:devbox "$workspace_dir"',
    "  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then",
    '    sudo chown -R devbox:devbox "$workspace_dir"',
    "  fi",
    "fi",
  ].join("\n");
}

/** Branch/tree URL for `skills add`; default brain-deploy, override via DEPLOY_SKILL_SOURCE. */
export function buildDeploySkillInstallCommand(skillSource: string): string {
  return [
    "set -euo pipefail",
    `workspace_dir=${shellQuote(DEPLOY_WORKSPACE_DIR)}`,
    `skill_source=${shellQuote(skillSource)}`,
    'agent_skill_marker="$workspace_dir/.agents/skills/sealos-deploy/SKILL.md"',
    'agent_build_skill_marker="$workspace_dir/.agents/skills/k8s-kaniko-job/SKILL.md"',
    'codex_skill_marker="$workspace_dir/.codex/skills/sealos-deploy/SKILL.md"',
    'codex_build_skill_marker="$workspace_dir/.codex/skills/k8s-kaniko-job/SKILL.md"',
    "if ! command -v npx >/dev/null 2>&1; then",
    "  printf 'ERROR: npx is required to install sealos-deploy skill\\n' >&2",
    "  exit 1",
    "fi",
    "for skill_name in sealos-deploy dockerfile-skill k8s-kaniko-job cloud-native-readiness docker-to-sealos; do",
    '  rm -rf "$workspace_dir/.agents/skills/$skill_name"',
    '  rm -rf "$workspace_dir/.codex/skills/$skill_name"',
    "done",
    'cd "$workspace_dir"',
    `timeout ${SKILL_INSTALL_COMMAND_TIMEOUT_SECONDS} npx --yes skills@${DEPLOY_SKILLS_CLI_VERSION} add "$skill_source" -y`,
    'if [ ! -f "$agent_skill_marker" ] && [ ! -f "$codex_skill_marker" ]; then',
    "  printf 'ERROR: sealos-deploy skill not found after install\\n' >&2",
    "  exit 1",
    "fi",
    'if [ ! -f "$agent_build_skill_marker" ] && [ ! -f "$codex_build_skill_marker" ]; then',
    "  printf 'ERROR: k8s-kaniko-job skill not found after install\\n' >&2",
    "  exit 1",
    "fi",
  ].join("\n");
}

function deployOutputReadScript(): string {
  return [
    "const fs = require('fs');",
    "const readJson = (path) => fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, 'utf8')) : null;",
    "const readText = (path) => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : null;",
    "const deliveryManifest = readJson(process.env.MANIFEST_PATH);",
    "const buildResult = readJson(process.env.BUILD_RESULT_PATH);",
    "const templateYaml = readText(process.env.TEMPLATE_PATH);",
    "const output = {};",
    "if (deliveryManifest != null) output.deliveryManifest = deliveryManifest;",
    "if (buildResult != null) output.buildResult = buildResult;",
    "if (typeof templateYaml === 'string' && templateYaml.trim()) output.templateYaml = templateYaml;",
    "process.stdout.write(JSON.stringify(output));",
  ].join(" ");
}

function readDeployOutputCommand(input?: { allowPartial?: boolean }): string {
  const requiredFileChecks =
    input?.allowPartial === true
      ? []
      : [
          'test -f "$manifest_path"',
          'test -f "$build_result_path"',
          'test -f "$template_path"',
        ];
  return [
    "set -euo pipefail",
    `manifest_path=${shellQuote(DEPLOY_DELIVERY_MANIFEST_PATH)}`,
    `build_result_path=${shellQuote(DEPLOY_BUILD_RESULT_PATH)}`,
    `template_path=${shellQuote(DEPLOY_TEMPLATE_YAML_PATH)}`,
    ...requiredFileChecks,
    `MANIFEST_PATH="$manifest_path" BUILD_RESULT_PATH="$build_result_path" TEMPLATE_PATH="$template_path" node -e ${shellQuote(
      deployOutputReadScript()
    )}`,
  ].join("\n");
}

async function ensureDeployDevbox(input: {
  deadlineAtMs?: number;
  env?: Record<string, string>;
  existingRuntimeName?: string | null;
  githubToken?: string;
  namespace: string;
  repoUrl: string;
  resolveGatewayCredentials?: (
    signal?: AbortSignal
  ) => Promise<CodexGatewayOpenAiCredentials>;
  signal?: AbortSignal;
  taskId: string;
}): Promise<{ info: DevboxInfo; name: string }> {
  const existingRuntimeName = input.existingRuntimeName?.trim();
  if (existingRuntimeName) {
    const info = await ensureRunningDevbox(
      input.namespace,
      existingRuntimeName,
      input.taskId,
      input.deadlineAtMs,
      input.signal
    );
    await refreshDevboxPause(
      input.namespace,
      existingRuntimeName,
      {
        pauseAt: getPauseAt(),
      },
      input.signal
    );
    return { info, name: existingRuntimeName };
  }

  const hash = runtimeHash({
    namespace: input.namespace,
    sourceKey: input.repoUrl,
    taskId: input.taskId,
  });
  const name = runtimeName(hash);
  const upstreamID = runtimeUpstreamId(hash);
  const existing = (
    await listDevboxes(input.namespace, upstreamID, input.signal)
  ).data.items[0];

  if (existing != null) {
    const info = await ensureRunningDevbox(
      input.namespace,
      existing.name,
      input.taskId,
      input.deadlineAtMs,
      input.signal
    );
    await refreshDevboxPause(
      input.namespace,
      existing.name,
      {
        pauseAt: getPauseAt(),
      },
      input.signal
    );
    return { info, name: existing.name };
  }

  const gatewayCredentials = await input.resolveGatewayCredentials?.(
    input.signal
  );
  try {
    await createDevbox(
      input.namespace,
      {
        env: {
          ...buildCodexGatewayEnv(gatewayCredentials),
          ...input.env,
          ...(input.githubToken?.trim()
            ? { GITHUB_TOKEN: input.githubToken.trim() }
            : {}),
          SEALAI_DEPLOY_TASK_ID: input.taskId,
          SEALAI_DEPLOY_WORKSPACE: DEPLOY_WORKSPACE_DIR,
        },
        image: getDevboxDefaultImage(),
        kubeAccess: {
          enabled: true,
          roleTemplate: "edit",
        },
        labels: [
          { key: "app.kubernetes.io/managed-by", value: "sealai" },
          { key: "app.kubernetes.io/component", value: "deploy-runtime" },
        ],
        name,
        pauseAt: getPauseAt(),
        storageLimit: getDeployDevboxStorageLimitFromEnv(process.env),
        upstreamID,
      },
      input.signal
    );

    const info = await waitForRunningDevbox({
      deadlineAtMs: input.deadlineAtMs,
      name,
      namespace: input.namespace,
      signal: input.signal,
      taskId: input.taskId,
    });
    return { info, name };
  } catch (error) {
    throw attachDeploySensitiveValues(
      error,
      gatewayCredentials == null ? [] : [gatewayCredentials.apiKey]
    );
  }
}

interface ExecOrThrowInput {
  command: string;
  deadlineAtMs?: number;
  namespace: string;
  runtimeName: string;
  stdin?: string;
  taskId: string;
  timeoutSeconds?: number;
}

function execOrThrowSignal(input: ExecOrThrowInput): AbortSignal {
  if (input.deadlineAtMs == null) {
    return deployTaskRunSignal(input.taskId);
  }
  return deploymentOperationSignal({
    deadlineAtMs: input.deadlineAtMs,
    taskId: input.taskId,
  });
}

function throwIfExecOrThrowAborted(
  input: ExecOrThrowInput,
  signal: AbortSignal
): void {
  if (input.deadlineAtMs == null) {
    throwIfDeployTaskAborted(input.taskId);
    return;
  }
  throwIfDeploymentOperationAborted({
    deadlineAtMs: input.deadlineAtMs,
    signal,
    taskId: input.taskId,
  });
}

function execOrThrowTimeoutSeconds(
  input: ExecOrThrowInput
): number | undefined {
  if (input.deadlineAtMs == null) {
    return input.timeoutSeconds;
  }
  return deploymentExecTimeoutSeconds({
    capMs:
      input.timeoutSeconds == null ? undefined : input.timeoutSeconds * 1000,
    deadlineAtMs: input.deadlineAtMs,
  });
}

function execOrThrowRetryDelayMs(input: ExecOrThrowInput): number {
  if (input.deadlineAtMs == null) {
    return DEVBOX_SDK_READY_RETRY_DELAY_MS;
  }
  return Math.min(
    DEVBOX_SDK_READY_RETRY_DELAY_MS,
    Math.max(0, input.deadlineAtMs - Date.now())
  );
}

async function execOrThrow(input: ExecOrThrowInput): Promise<void> {
  let attempt = 0;
  const signal = execOrThrowSignal(input);

  while (true) {
    if (input.deadlineAtMs != null) {
      throwIfDeploymentDeadlineElapsed(input.deadlineAtMs);
    }
    try {
      const result = (
        await execDevbox(
          input.namespace,
          input.runtimeName,
          {
            command: ["bash", "-lc", input.command],
            stdin: input.stdin,
            timeoutSeconds: execOrThrowTimeoutSeconds(input),
          },
          signal
        )
      ).data;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim());
      }
      return;
    } catch (error) {
      throwIfExecOrThrowAborted(input, signal);
      if (
        !isDevboxSdkPendingError(error) ||
        attempt >= DEVBOX_SDK_READY_MAX_RETRIES
      ) {
        throw error;
      }
      attempt += 1;
      await abortableSleep(execOrThrowRetryDelayMs(input), signal);
      throwIfExecOrThrowAborted(input, signal);
    }
  }
}

async function execForOutput(input: ExecOrThrowInput): Promise<string> {
  let attempt = 0;
  const signal = execOrThrowSignal(input);

  while (true) {
    if (input.deadlineAtMs != null) {
      throwIfDeploymentDeadlineElapsed(input.deadlineAtMs);
    }
    try {
      const result = (
        await execDevbox(
          input.namespace,
          input.runtimeName,
          {
            command: ["bash", "-lc", input.command],
            timeoutSeconds: execOrThrowTimeoutSeconds(input),
          },
          signal
        )
      ).data;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim());
      }
      return result.stdout;
    } catch (error) {
      throwIfExecOrThrowAborted(input, signal);
      if (
        !isDevboxSdkPendingError(error) ||
        attempt >= DEVBOX_SDK_READY_MAX_RETRIES
      ) {
        throw error;
      }
      attempt += 1;
      await abortableSleep(execOrThrowRetryDelayMs(input), signal);
      throwIfExecOrThrowAborted(input, signal);
    }
  }
}

function managedContractReadCommand(path: string, maxBytes: number): string {
  return [
    "set -euo pipefail",
    `contract_file=${shellQuote(path)}`,
    'test -f "$contract_file"',
    'bytes="$(wc -c < "$contract_file")"',
    `test "$bytes" -le ${maxBytes}`,
    'cat "$contract_file"',
  ].join("\n");
}

async function readManagedContract(input: {
  deadlineAtMs: number;
  maxBytes: number;
  namespace: string;
  path: string;
  runtimeName: string;
  taskId: string;
}): Promise<string> {
  return await execForOutput({
    command: managedContractReadCommand(input.path, input.maxBytes),
    deadlineAtMs: input.deadlineAtMs,
    namespace: input.namespace,
    runtimeName: input.runtimeName,
    taskId: input.taskId,
    timeoutSeconds: deploymentExecTimeoutSeconds({
      capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
      deadlineAtMs: input.deadlineAtMs,
    }),
  });
}

function managedBlockingInputs(
  request: ManagedInputsRequired
): DeployTaskBlockingInput[] {
  return request.inputs.map((field) => ({
    ...(field.description === undefined
      ? {}
      : { description: field.description }),
    id: field.id,
    key: field.key,
    label: field.label,
    ...(field.options === undefined ? {} : { options: field.options }),
    publicProjectionVersion:
      CURRENT_AI_BLOCKING_INPUT_PUBLIC_PROJECTION_VERSION,
    required: field.required,
    sensitive: field.sensitive,
    type: field.type,
    ...(field.valueType === undefined ? {} : { valueType: field.valueType }),
  }));
}

function managedDeploymentFieldManager(taskId: string): string {
  return `sealai-${createHash("sha256").update(taskId).digest("hex").slice(0, 24)}`;
}

async function writeManagedTurnControl(input: {
  control: ManagedDeploymentControl;
  deadlineAtMs: number;
  namespace: string;
  runtimeName: string;
  taskId: string;
}): Promise<void> {
  await execOrThrow({
    command: [
      "set -euo pipefail",
      `rm -f -- ${shellQuote(MANAGED_DEPLOYMENT_INPUTS_REQUIRED_PATH)} ${shellQuote(MANAGED_DEPLOYMENT_TURN_REPORT_PATH)} ${shellQuote(MANAGED_DEPLOYMENT_VERIFY_REPORT_PATH)}`,
      buildAtomicJsonWriteCommand({
        allowedRoot: MANAGED_DEPLOYMENT_CONTRACT_DIR,
        mode: "0644",
        path: MANAGED_DEPLOYMENT_CONTROL_PATH,
        value: input.control,
      }),
    ].join("\n"),
    deadlineAtMs: input.deadlineAtMs,
    namespace: input.namespace,
    runtimeName: input.runtimeName,
    taskId: input.taskId,
    timeoutSeconds: deploymentExecTimeoutSeconds({
      capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
      deadlineAtMs: input.deadlineAtMs,
    }),
  });
}

async function writeManagedInputValues(input: {
  deadlineAtMs: number;
  namespace: string;
  runtimeName: string;
  taskId: string;
  turnId: number;
  values: Record<string, string>;
}): Promise<string> {
  const probeText = await execForOutput({
    command: buildManagedInputMountProbeCommand(MANAGED_DEPLOYMENT_INPUT_ROOT),
    deadlineAtMs: input.deadlineAtMs,
    namespace: input.namespace,
    runtimeName: input.runtimeName,
    taskId: input.taskId,
    timeoutSeconds: deploymentExecTimeoutSeconds({
      capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
      deadlineAtMs: input.deadlineAtMs,
    }),
  });
  const decision = selectManagedInputPath({
    candidates: [
      {
        archiveExcluded: true,
        kind: "tmpfs",
        probe: parseManagedInputMountProbe(probeText),
        root: MANAGED_DEPLOYMENT_INPUT_ROOT,
        wipeVerified: true,
      },
    ],
    taskId: input.taskId,
  });
  const accepted = decision.accepted;
  if (accepted == null) {
    throw new Error(
      "No verified ephemeral path is available for deployment inputs."
    );
  }
  try {
    const inputContents = `${JSON.stringify(
      {
        schemaVersion: 1,
        taskId: input.taskId,
        turnId: input.turnId,
        values: input.values,
      },
      null,
      2
    )}\n`;
    if (
      Buffer.byteLength(inputContents, "utf8") > MANAGED_INPUT_VALUES_MAX_BYTES
    ) {
      throw new Error(
        "Managed deployment input values exceed their byte limit."
      );
    }
    await execOrThrow({
      command: buildAtomicStdinWriteCommand({
        allowedRoot: MANAGED_DEPLOYMENT_INPUT_ROOT,
        maxBytes: MANAGED_INPUT_VALUES_MAX_BYTES,
        path: accepted.inputPath,
      }),
      deadlineAtMs: input.deadlineAtMs,
      namespace: input.namespace,
      runtimeName: input.runtimeName,
      stdin: inputContents,
      taskId: input.taskId,
      timeoutSeconds: deploymentExecTimeoutSeconds({
        capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
        deadlineAtMs: input.deadlineAtMs,
      }),
    });
    await execOrThrow({
      command: buildAtomicJsonWriteCommand({
        allowedRoot: MANAGED_DEPLOYMENT_CONTRACT_DIR,
        path: MANAGED_DEPLOYMENT_INPUT_REF_PATH,
        value: {
          path: accepted.inputPath,
          schemaVersion: 1,
          taskId: input.taskId,
          turnId: input.turnId,
        },
      }),
      deadlineAtMs: input.deadlineAtMs,
      namespace: input.namespace,
      runtimeName: input.runtimeName,
      taskId: input.taskId,
      timeoutSeconds: deploymentExecTimeoutSeconds({
        capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
        deadlineAtMs: input.deadlineAtMs,
      }),
    });
  } catch (error) {
    await removeManagedInputValues({
      inputPath: accepted.inputPath,
      namespace: input.namespace,
      runtimeName: input.runtimeName,
      taskId: input.taskId,
    }).catch(() => undefined);
    throw error;
  }
  return accepted.inputPath;
}

async function removeManagedInputValues(input: {
  inputPath: string;
  namespace: string;
  runtimeName: string;
  taskId: string;
}): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = (
        await execDevbox(
          input.namespace,
          input.runtimeName,
          {
            command: [
              "bash",
              "-lc",
              [
                buildManagedInputRemovalCommand({
                  inputPath: input.inputPath,
                  root: MANAGED_DEPLOYMENT_INPUT_ROOT,
                  taskId: input.taskId,
                }),
                `rm -f -- ${shellQuote(MANAGED_DEPLOYMENT_INPUT_REF_PATH)}`,
              ].join("\n"),
            ],
            timeoutSeconds: 30,
          },
          AbortSignal.timeout(30_000)
        )
      ).data;
      if (result.exitCode === 0) {
        return;
      }
    } catch {
      // Cleanup uses a fresh signal and retries independently from turn aborts.
    }
  }
  throw new Error("Failed to remove managed deployment input values.");
}

async function readDeployOutput(input: {
  allowPartial?: boolean;
  deadlineAtMs?: number;
  namespace: string;
  runtimeName: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown> | null> {
  const remainingDeadlineMs =
    input.deadlineAtMs == null
      ? null
      : remainingDeploymentTimeoutMs({
          deadlineAtMs: input.deadlineAtMs,
        });
  if (remainingDeadlineMs != null && remainingDeadlineMs <= 0) {
    throwIfDeploymentDeadlineElapsed(input.deadlineAtMs as number);
  }
  const deadlineSignal =
    remainingDeadlineMs == null
      ? undefined
      : AbortSignal.timeout(Math.max(1, remainingDeadlineMs));
  const signal = combinedAbortSignal(input.signal, deadlineSignal);

  let result: Awaited<ReturnType<typeof execDevbox>>["data"];
  try {
    result = (
      await execDevbox(
        input.namespace,
        input.runtimeName,
        {
          command: [
            "bash",
            "-lc",
            readDeployOutputCommand({ allowPartial: input.allowPartial }),
          ],
          timeoutSeconds:
            input.deadlineAtMs == null
              ? READ_OUTPUT_TIMEOUT_SECONDS
              : deploymentExecTimeoutSeconds({
                  capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
                  deadlineAtMs: input.deadlineAtMs,
                }),
        },
        signal
      )
    ).data;
  } catch (error) {
    input.signal?.throwIfAborted();
    if (input.deadlineAtMs != null && deadlineSignal?.aborted) {
      throwIfDeploymentDeadlineElapsed(input.deadlineAtMs);
    }
    throw error;
  }
  input.signal?.throwIfAborted();
  if (input.deadlineAtMs != null && deadlineSignal?.aborted) {
    throwIfDeploymentDeadlineElapsed(input.deadlineAtMs);
  }

  if (result.exitCode !== 0 || result.stdout.trim() === "") {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const output = parsed as Record<string, unknown>;
  return Object.keys(output).length === 0 ? null : output;
}

async function recordDeployOutputProgress(input: {
  summary: Record<string, unknown>;
  taskId: string;
}): Promise<string> {
  const complete = input.summary.complete === true;
  const kind = complete
    ? "deployment_task.output_ready"
    : "deployment_task.output_partial";
  const message = complete
    ? "Deployment output files are ready."
    : "Deployment output files are partially available.";
  const signature = JSON.stringify(input.summary);
  const now = new Date().toISOString();

  await updateDeployTaskTimeline(input.taskId, {
    event: {
      kind,
      message,
      payload: input.summary,
      phase: "generate-artifacts",
    },
    update: (timeline) =>
      applyDeploymentOutputProgressToTimeline(timeline, {
        complete,
        event: timelineEvent({
          dedupeKey: `${kind}:${signature}`,
          message,
          severity: complete ? "success" : "info",
          source: "runner",
        }),
        updatedAt: now,
      }),
  });
  return signature;
}

async function recordDeployOutputProgressIfPresent(input: {
  output: Record<string, unknown> | null;
  seenSignatures?: Set<string>;
  taskId: string;
}): Promise<void> {
  const summary = deployOutputProgressSummary(input.output);
  if (summary == null) {
    return;
  }
  const signature = JSON.stringify(summary);
  if (input.seenSignatures?.has(signature)) {
    return;
  }
  input.seenSignatures?.add(signature);
  await recordDeployOutputProgress({
    summary,
    taskId: input.taskId,
  });
}

function completeAiDeploymentOutput(
  output: Record<string, unknown> | null
): Record<string, unknown> | null {
  return deployOutputProgressSummary(output)?.complete === true ? output : null;
}

async function monitorDeployOutputProgress(input: {
  deadlineAtMs: number;
  namespace: string;
  runtimeName: string;
  seenSignatures: Set<string>;
  signal: AbortSignal;
  taskId: string;
}): Promise<void> {
  while (
    !input.signal.aborted &&
    remainingDeploymentTimeoutMs({ deadlineAtMs: input.deadlineAtMs }) > 0
  ) {
    try {
      const output = await readDeployOutput({
        allowPartial: true,
        deadlineAtMs: input.deadlineAtMs,
        namespace: input.namespace,
        runtimeName: input.runtimeName,
        signal: input.signal,
      });
      if (await recordMonitoredDeployOutputProgress(input, output)) {
        return;
      }
    } catch {
      if (input.signal.aborted) {
        return;
      }
      // Progress polling is best-effort; the gateway turn remains authoritative.
    }

    await abortableSleep(
      Math.min(
        DEPLOY_OUTPUT_PROGRESS_POLL_MS,
        Math.max(0, input.deadlineAtMs - Date.now())
      ),
      input.signal
    );
    if (input.signal.aborted) {
      return;
    }
  }
}

async function recordMonitoredDeployOutputProgress(
  input: Pick<
    Parameters<typeof monitorDeployOutputProgress>[0],
    "seenSignatures" | "signal" | "taskId"
  >,
  output: Record<string, unknown> | null
): Promise<boolean> {
  if (input.signal.aborted) {
    return true;
  }
  const summary = deployOutputProgressSummary(output);
  if (summary == null) {
    return false;
  }
  const signature = JSON.stringify(summary);
  if (!input.seenSignatures.has(signature)) {
    input.seenSignatures.add(signature);
    await recordDeployOutputProgress({
      summary,
      taskId: input.taskId,
    });
  }
  return input.signal.aborted || summary.complete === true;
}

async function runDeployTaskGatewayWithOutputProgress(input: {
  context: GatewayContext;
  deadlineAtMs: number;
  existingSessionId?: string | null;
  namespace: string;
  pauseOnError?: boolean;
  repairOutput?: boolean;
  resumeMode?: ManagedDeployResumeMode;
  runtimeName: string;
  seenSignatures: Set<string>;
  task: DeployTaskRow;
}): Promise<string> {
  const monitorController = new AbortController();
  const monitorSignal = AbortSignal.any([
    monitorController.signal,
    deployTaskRunSignal(input.task.id),
    AbortSignal.timeout(
      Math.max(
        1,
        remainingDeploymentTimeoutMs({ deadlineAtMs: input.deadlineAtMs })
      )
    ),
  ]);
  const monitor = monitorDeployOutputProgress({
    deadlineAtMs: input.deadlineAtMs,
    namespace: input.namespace,
    runtimeName: input.runtimeName,
    seenSignatures: input.seenSignatures,
    signal: monitorSignal,
    taskId: input.task.id,
  });

  try {
    return await runDeployTaskGateway({
      context: input.context,
      deadlineAtMs: input.deadlineAtMs,
      existingSessionId: input.existingSessionId,
      repairOutput: input.repairOutput,
      resumeMode: input.resumeMode,
      task: input.task,
    });
  } catch (error) {
    monitorController.abort();
    if (input.pauseOnError !== false) {
      try {
        await pauseDevbox(
          input.namespace,
          input.runtimeName,
          AbortSignal.timeout(DEPLOY_TIMEOUT_POLICY.gatewayCleanupMs)
        );
      } catch (pauseError) {
        const httpStatus =
          pauseError instanceof DevboxApiError ? pauseError.status : undefined;
        console.warn(
          `[deploy-task] Failed to pause Devbox after Gateway error for ${input.task.id}.`,
          httpStatus == null ? {} : { httpStatus }
        );
      }
    }
    throw withDeployFailureDetails(error, codexGatewayFailureDetails(error));
  } finally {
    monitorController.abort();
    await monitor;
  }
}

async function markDeploymentGenerationStartedIfNeeded(input: {
  seenOutputProgress: Set<string>;
  taskId: string;
}) {
  if (input.seenOutputProgress.size > 0) {
    return;
  }
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.deployment_generation_started",
    eventMessage: "Generating deployment artifacts.",
    phase: "generate-artifacts",
    status: "running",
    stepId: "generate-deployment",
    taskId: input.taskId,
  });
}

function artifactOperationalIdentifiers(
  artifact: DeploymentArtifact
): string[] {
  switch (artifact.kind) {
    case "brain-manifest":
      return [];
    case "sealos-template":
      return [
        artifact.instanceName,
        artifact.templateName,
        ...artifact.rendered.resources.flatMap((resource) => [
          resource.metadata?.name ?? "",
          resource.metadata?.namespace ?? "",
        ]),
      ];
    case "template-instance":
      return [
        artifact.instanceName,
        artifact.templateName,
        ...artifact.resources.map((resource) => resource.name),
      ];
    case "template-instance-pending":
      return [artifact.instanceName, artifact.templateName];
    default:
      return artifact satisfies never;
  }
}

function assertArtifactOperationalIdentifiers(
  artifact: DeploymentArtifact,
  sensitiveValues: readonly string[]
): void {
  if (
    artifactOperationalIdentifiers(artifact).some((identifier) =>
      sensitiveValues.some(
        (sensitiveValue) =>
          sensitiveValue.length > 0 && identifier.includes(sensitiveValue)
      )
    )
  ) {
    throw new Error(
      "Deployment resource identity cannot contain a sensitive input value."
    );
  }
}

function assertAiArtifactHasNoSubmittedIdentityInputs(
  artifact: DeploymentArtifact
): void {
  if (
    artifact.kind === "sealos-template" &&
    (artifact.rendered.submittedIdentityInputKeys?.length ?? 0) > 0
  ) {
    throw new Error(
      "Deployment resource identity cannot depend on a submitted input value."
    );
  }
}

async function completeTaskWithArtifact(input: {
  artifact: DeploymentArtifact;
  artifactSummaryExtras?: Partial<DeployTaskArtifactSummary>;
  completionEventMessage?: string;
  completionEventKind?: string;
  completionRecordMessage?: string;
  githubToken?: string;
  kubeconfig: string;
  /** AI-rendered Template YAML can contain submitted form values. */
  omitRenderedYaml?: boolean;
  outputJson?: Record<string, unknown>;
  /** Sensitive arg values to scrub from every persisted artifact copy. */
  sensitiveValues?: string[];
  task: DeployTaskRow;
}) {
  const sensitiveValues = input.sensitiveValues ?? [];
  const taskDeadlineAtMs = deployTaskDeadlineAt({
    leaseClaimedAt: input.task.leaseClaimedAt,
  });
  const applyDeadlineAtMs = deploymentPhaseDeadlineAt({
    budgetMs: DEPLOY_TIMEOUT_POLICY.applyMs,
    reserveMs:
      DEPLOY_TIMEOUT_POLICY.readinessMs + DEPLOY_TIMEOUT_POLICY.finalizeMs,
    taskDeadlineAtMs,
  });
  throwIfDeploymentDeadlineElapsed(applyDeadlineAtMs);
  assertArtifactOperationalIdentifiers(input.artifact, sensitiveValues);
  await deployTaskCheckpoint(input.task.id);
  await deployTaskBeginApplying(input.task.id);
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.apply_started",
    message: "Applying deployment artifacts.",
    phase: "apply",
  });
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.apply_started",
    eventMessage: "Applying deployment artifacts.",
    phase: "apply",
    status: "running",
    stepId: "create-resources",
    taskId: input.task.id,
  });

  let applied: Awaited<ReturnType<typeof applyDeploymentArtifact>>;
  const applySignal = deploymentOperationSignal({
    deadlineAtMs: applyDeadlineAtMs,
    stage: "apply",
    taskId: input.task.id,
  });
  try {
    applied = await applyDeploymentArtifact({
      artifact: input.artifact,
      githubToken: input.githubToken,
      kubeconfig: input.kubeconfig,
      signal: applySignal,
      task: input.task,
    });
  } catch (error) {
    throwIfDeploymentOperationAborted({
      deadlineAtMs: applyDeadlineAtMs,
      signal: applySignal,
      stage: "apply",
      taskId: input.task.id,
    });
    throw withDeployFailureDetails(error, {
      artifactKind: input.artifact.kind,
      reason: applyFailureReason(error),
      resourceCount:
        "resources" in input.artifact && Array.isArray(input.artifact.resources)
          ? input.artifact.resources.length
          : undefined,
      source: "applyDeploymentArtifact",
      // The one stage where this run may have partially created resources —
      // the only stage template failure cleanup may act on (ADR 0037/0038).
      stage: "apply",
      templateName:
        input.artifact.kind === "sealos-template" ||
        input.artifact.kind === "template-instance-pending"
          ? input.artifact.templateName
          : undefined,
    });
  }
  throwIfDeploymentDeadlineElapsed(applyDeadlineAtMs);

  // The scrubbed copy is what every persisted form gets — the row summary
  // and the completion event payload alike (ADR 0037 row-level contract).
  const artifactSummary = input.omitRenderedYaml
    ? (() => {
        const { resourceYamls: _resourceYamls, ...summary } =
          applied.artifactSummary;
        return summary;
      })()
    : applied.artifactSummary;
  const persistedSummary = artifactSummaryWithScrubbedValues(
    artifactSummary,
    sensitiveValues
  );
  const persistedTaskSummary = artifactSummaryWithScrubbedValues(
    {
      ...artifactSummary,
      ...(input.artifactSummaryExtras ?? {}),
      notes: applied.notes,
      ...(input.outputJson === undefined
        ? {}
        : { outputJson: input.outputJson }),
      // Recorded result identities survive summary rewrites (ADR 0038).
      ...appliedResultIdentities(input.task, input.artifact),
    },
    sensitiveValues
  );
  await updateDeployTaskState(input.task.id, {
    artifactSummary: persistedTaskSummary,
  });
  throwIfDeploymentDeadlineElapsed(applyDeadlineAtMs);

  const resultCards = resultResourceCardsFromArtifactSummary(persistedSummary);
  for (const card of resultCards) {
    await upsertResultTimelineCard({
      card,
      eventMessage: `${resultReadinessLabel(card)} result resource was created.`,
      eventReason: "ResultResourceKnown",
      taskId: input.task.id,
    });
    throwIfDeploymentDeadlineElapsed(applyDeadlineAtMs);
  }

  // Reaching completed requires Deployment Result Readiness (ADR 0028): a
  // readiness timeout throws and resolves to failed with the resources
  // preserved — never a completed-on-timeout.
  if (resultCards.some((card) => card.required)) {
    const readinessDeadlineAtMs = deploymentPhaseDeadlineAt({
      budgetMs: DEPLOY_TIMEOUT_POLICY.readinessMs,
      reserveMs: DEPLOY_TIMEOUT_POLICY.finalizeMs,
      taskDeadlineAtMs,
    });
    await waitForRequiredResultCards({
      cards: resultCards,
      deadlineAtMs: readinessDeadlineAtMs,
      kubeconfig: input.kubeconfig,
      surfaceObservationError: input.task.runner.kind !== "ai",
      taskId: input.task.id,
    });
  }

  throwIfDeploymentDeadlineElapsed(taskDeadlineAtMs);
  await markTimelineStepWithEvent({
    eventKind:
      input.completionEventKind ?? "deployment_task.result_readiness_reached",
    eventMessage:
      input.completionEventMessage ??
      "Required deployment result resources are running.",
    phase: "apply",
    status: "completed",
    stepId: "create-resources",
    taskId: input.task.id,
  });
  await deployTaskComplete(input.task.id, {
    kind: "deployment_task.completed",
    message: input.completionRecordMessage ?? "Deployment task completed.",
    payload: { artifactSummary: persistedSummary },
    phase: "completed",
  });
}

function appliedResultIdentities(
  task: DeployTaskRow,
  artifact: DeploymentArtifact
): Pick<DeployTaskArtifactSummary, "resultIdentities"> {
  if (artifact.kind === "sealos-template") {
    return {
      resultIdentities: {
        ...task.artifactSummary.resultIdentities,
        templateInstanceName: artifact.instanceName,
      },
    };
  }
  if (task.artifactSummary.resultIdentities == null) {
    return {};
  }
  return { resultIdentities: task.artifactSummary.resultIdentities };
}

function submittedInputStringValues(
  value: Record<string, unknown> | undefined
): Record<string, string> {
  if (value == null) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => {
      if (typeof item === "string") {
        return [[key, item]];
      }
      if (typeof item === "number" || typeof item === "boolean") {
        return [[key, String(item)]];
      }
      return [];
    })
  );
}

function deploymentPlanArgsFromTask(
  task: DeployTaskRow
): Record<string, string> {
  const args = task.artifactSummary.deploymentPlan?.args;
  return args == null ? {} : { ...args };
}

export function resolveAiTemplateInstanceName(input: {
  deliveryManifest: Record<string, unknown>;
  task: DeployTaskRow;
  templateName: string;
}): string {
  return (
    recordedTemplateInstanceName(input.task) ||
    sealosTemplateInstanceName({
      deliveryManifest: input.deliveryManifest,
      projectName: input.task.projectName ?? input.templateName,
      templateName: input.templateName,
    })
  );
}

/**
 * Direct/template runner secret contract (ADR 0037): submitted sensitive
 * values must never be persisted anywhere on the task row. The full args live
 * only in process memory for the apply itself. AI-generated Template output
 * follows its separate public-configuration contract and does not call this
 * guard.
 */
function assertPersistableSensitiveValues(values: readonly string[]): void {
  if (values.some((value) => value.length < MIN_SENSITIVE_INPUT_LENGTH)) {
    throw new Error(
      "Generated deployment contains a sensitive value shorter than four characters."
    );
  }
}

/**
 * AI deployment output is public configuration by contract. Validate the
 * Template header, then retain the raw Sealos DSL and generated manifest
 * unchanged. Submitted form values never enter this object.
 */
export function persistableAiDeployOutput(input: {
  deliveryManifest: Record<string, unknown>;
  output: Record<string, unknown>;
}): {
  deliveryManifest: Record<string, unknown>;
  outputJson: Record<string, unknown>;
} {
  const templateYaml = input.output.templateYaml;
  const persistableTemplate =
    typeof templateYaml === "string"
      ? persistableSealosTemplate(templateYaml)
      : null;
  const deliveryManifest = input.deliveryManifest;
  const outputJson = {
    ...input.output,
    deliveryManifest,
    ...(persistableTemplate == null
      ? {}
      : { templateYaml: persistableTemplate.templateYaml }),
  };
  return {
    deliveryManifest,
    outputJson,
  };
}

function outputJsonFromArtifactSummary(
  task: DeployTaskRow
): Record<string, unknown> | null {
  const output = task.artifactSummary.outputJson;
  return output != null && typeof output === "object" && !Array.isArray(output)
    ? (output as Record<string, unknown>)
    : null;
}

async function blockForDeploymentInputs(input: {
  deploymentPlan: ReturnType<typeof createSealosTemplateDeploymentPlan>;
  summary: DeployTaskArtifactSummary;
  task: DeployTaskRow;
}) {
  const blockingInputs = blockingInputsFromDeploymentPlan(input.deploymentPlan);
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.input_required",
    eventMessage: `Deployment requires ${blockingInputs.length} configuration value${blockingInputs.length === 1 ? "" : "s"}.`,
    eventPayload: {
      inputKeys: blockingInputs.map((item) => item.key ?? item.id),
    },
    eventSeverity: "warning",
    phase: "configure",
    status: "blocked",
    stepId: "generate-deployment",
    taskId: input.task.id,
    timelineStatus: "blocked",
  });
  // The blocked transition releases the lease and ends this run — it must be
  // the run's final write.
  await deployTaskRequestInputs(input.task.id, {
    blockingInputs,
    phase: "configure",
    state: { artifactSummary: input.summary },
  });
}

async function reblockRejectedSubmittedAiInput(input: {
  currentBlockingInputs?: readonly DeployTaskBlockingInput[];
  error: unknown;
  submittedInputKeys?: ReadonlySet<string>;
  task: DeployTaskRow;
}): Promise<boolean> {
  if (!(input.error instanceof TemplateInputValidationError)) {
    return false;
  }
  const validationError = input.error;
  if (validationError.valueSource !== "provided") {
    return false;
  }
  const currentBlockingInputs = input.currentBlockingInputs ?? [];
  const authoritativeBlockingInputKeys = new Set(
    currentBlockingInputs.map((item) => item.key ?? item.id)
  );
  if (
    input.submittedInputKeys?.has(validationError.inputKey) !== true ||
    !authoritativeBlockingInputKeys.has(validationError.inputKey)
  ) {
    return false;
  }
  const rejectedInputIndex = currentBlockingInputs.findIndex(
    (item) => (item.key ?? item.id) === validationError.inputKey
  );
  const rejectedInput = currentBlockingInputs[rejectedInputIndex];
  if (rejectedInput == null) {
    return false;
  }
  const eventInputKey = rejectedInput.key ?? rejectedInput.id;
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.input_rejected",
    message: "A deployment configuration value was rejected.",
    payload: { code: validationError.code, inputKey: eventInputKey },
    phase: "configure",
  });
  await deployTaskRequestInputs(input.task.id, {
    blockingInputs: [...currentBlockingInputs],
    phase: "configure",
  });
  return true;
}

function aiPublicProjectionIsTrusted(input: {
  generatedByCurrentRunner?: boolean;
  task: DeployTaskRow;
}): boolean {
  return (
    input.generatedByCurrentRunner === true ||
    input.task.artifactSummary.publicProjectionVersion ===
      CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION
  );
}

function aiPublicProjectionStamp(
  trusted: boolean
): Pick<DeployTaskArtifactSummary, "publicProjectionVersion"> {
  return trusted
    ? {
        publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
      }
    : {};
}

function aiArtifactSummaryExtras(input: {
  deploymentPlan: DeploymentTaskDeploymentPlan | undefined;
  trustedPublicProjection: boolean;
}): Partial<DeployTaskArtifactSummary> {
  return {
    ...(input.deploymentPlan == null
      ? {}
      : { deploymentPlan: input.deploymentPlan }),
    ...aiPublicProjectionStamp(input.trustedPublicProjection),
  };
}

async function applyAiDeploymentFromPreparedOutput(input: {
  args: Record<string, string>;
  deploymentPlan?: DeploymentTaskDeploymentPlan;
  encodedKubeconfig: string;
  githubToken?: string;
  kubeconfig: string;
  outputJson: Record<string, unknown>;
  currentBlockingInputs?: readonly DeployTaskBlockingInput[];
  submittedInputKeys?: ReadonlySet<string>;
  task: DeployTaskRow;
  templateYaml: string;
  trustedPublicProjection?: boolean;
}) {
  const trustedPublicProjection = aiPublicProjectionIsTrusted({
    generatedByCurrentRunner: input.trustedPublicProjection,
    task: input.task,
  });
  // A recorded identity predates this run (clone copy per ADR 0038, or an
  // earlier run's fenced allocation), so the cleanup label selector may match
  // preserved resources this run never created.
  const identityFreshlyAllocated =
    recordedTemplateInstanceName(input.task) === "";
  const deploymentPlan =
    input.deploymentPlan ?? input.task.artifactSummary.deploymentPlan;
  let artifact: DeploymentArtifact;
  try {
    artifact = prepareSealosTemplateArtifact({
      args: input.args,
      buildResult: requiredObjectValue(input.outputJson, "buildResult"),
      certSecretName: sealosCertSecretName(),
      deliveryManifest: requiredObjectValue(
        input.outputJson,
        "deliveryManifest"
      ),
      instanceName:
        input.task.artifactSummary.resultIdentities?.templateInstanceName ??
        deploymentPlan?.instanceName,
      identityInputKeys: input.submittedInputKeys,
      routingDomain: apUserDomain(input.kubeconfig),
      task: input.task,
      templateYaml: input.templateYaml,
      declarationState: deploymentPlan?.renderState,
    });
  } catch (error) {
    if (isDeployTaskAbortError(error)) {
      throw error;
    }
    if (
      await reblockRejectedSubmittedAiInput({
        currentBlockingInputs: input.currentBlockingInputs,
        error,
        submittedInputKeys: input.submittedInputKeys,
        task: input.task,
      })
    ) {
      return;
    }
    const buildResult = objectValue(input.outputJson.buildResult);
    const buildStatus = normalizeBuildResultStatus(
      stringValue(buildResult?.status)
    );
    if (buildStatus === "failed" || buildStatus === "running") {
      throw withDeployFailureDetails(error, {
        reason: "image-build-failed",
      });
    }
    throw error;
  }
  // Every user-submitted value is request-memory-only. Resource identities
  // are persisted, so reject a render that would copy a submitted value there.
  assertAiArtifactHasNoSubmittedIdentityInputs(artifact);
  const summary = {
    ...sealosTemplateArtifactSummary({ artifact, includeRenderedYaml: false }),
    ...(deploymentPlan == null ? {} : { deploymentPlan }),
    outputJson: input.outputJson,
    ...aiPublicProjectionStamp(trustedPublicProjection),
    resultIdentities: {
      ...input.task.artifactSummary.resultIdentities,
      ...(artifact.kind === "sealos-template"
        ? { templateInstanceName: artifact.instanceName }
        : {}),
    },
  };
  await updateDeployTaskState(input.task.id, {
    artifactSummary: summary,
    phase: "configure",
  });
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.input_ready",
    eventMessage: "Deployment configuration is ready.",
    eventSeverity: "success",
    phase: "configure",
    status: "completed",
    stepId: "generate-deployment",
    taskId: input.task.id,
    timelineStatus: "running",
  });
  const artifactSummaryExtras = aiArtifactSummaryExtras({
    deploymentPlan,
    trustedPublicProjection,
  });

  try {
    await completeTaskWithArtifact({
      artifact,
      artifactSummaryExtras,
      githubToken: input.githubToken,
      kubeconfig: input.kubeconfig,
      omitRenderedYaml: true,
      outputJson: input.outputJson,
      task: input.task,
    });
  } catch (error) {
    // An abort is a typed cancellation outcome, never a failure: it must not
    // reach failure cleanup, which deletes partial resources (ADR 0038).
    if (isDeployTaskAbortError(error)) {
      throw error;
    }
    // Readiness timeouts and every other non-apply failure preserve the
    // created resources (ADR 0037); see templateCleanupAllowed.
    if (templateCleanupAllowed(error, { identityFreshlyAllocated })) {
      await cleanupFailedTemplateDeployment({
        encodedKubeconfig: input.encodedKubeconfig,
        instanceName: artifact.instanceName,
        projectId: input.task.projectId ?? artifact.instanceName,
        task: input.task,
      });
    }
    throw error;
  }
}

async function applyGeneratedAiDeployOutput(input: {
  encodedKubeconfig: string;
  githubToken?: string;
  kubeconfig: string;
  output: Record<string, unknown>;
  task: DeployTaskRow;
}) {
  const deliveryManifest = requiredObjectValue(
    input.output,
    "deliveryManifest"
  );
  const templateYaml = requiredStringValue(input.output, "templateYaml");
  const templateName = templateSourceFromInlineYaml(templateYaml).templateName;
  const plannedInstanceName = resolveAiTemplateInstanceName({
    deliveryManifest,
    task: input.task,
    templateName,
  });
  const deploymentPlan = createSealosTemplateDeploymentPlan({
    declarationContext: {
      certSecretName: sealosCertSecretName(),
      instanceName: plannedInstanceName,
      namespace: input.task.namespace,
      routingDomain: apUserDomain(input.kubeconfig),
    },
    deliveryManifest,
    templateYaml,
  });
  const persistable = persistableAiDeployOutput({
    deliveryManifest,
    output: input.output,
  });
  const baseSummary: DeployTaskArtifactSummary = {
    buildResult: requiredObjectValue(persistable.outputJson, "buildResult"),
    deliveryManifest: persistable.deliveryManifest,
    deploymentPlan,
    outputJson: persistable.outputJson,
    publicProjectionVersion: CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
  };
  if ((deploymentPlan.missingInputKeys?.length ?? 0) > 0) {
    await updateDeployTaskState(input.task.id, {
      artifactSummary: baseSummary,
      phase: "generate-artifacts",
    });
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.artifacts_generated",
      message: "Generated Sealos template deployment artifact.",
      payload: {
        requiredInputs: deploymentPlan.missingInputKeys ?? [],
      },
      phase: "generate-artifacts",
    });
    await markTimelineStepWithEvent({
      eventKind: "deployment_task.artifacts_generated",
      eventMessage: "Generated Sealos template deployment artifact.",
      phase: "generate-artifacts",
      status: "completed",
      stepId: "generate-deployment",
      taskId: input.task.id,
    });
    await blockForDeploymentInputs({
      deploymentPlan,
      summary: baseSummary,
      task: input.task,
    });
    return;
  }

  await applyAiDeploymentFromPreparedOutput({
    args: deployTaskStringRecordValue(deliveryManifest.args),
    deploymentPlan,
    encodedKubeconfig: input.encodedKubeconfig,
    githubToken: input.githubToken ?? undefined,
    kubeconfig: input.kubeconfig,
    outputJson: persistable.outputJson,
    task: input.task,
    templateYaml,
    trustedPublicProjection: true,
  });
}

/**
 * This direct run's known sensitive values are used to scrub an apply error
 * that echoed one (ADR 0042). Database settings hold no user secret.
 */
function directSensitiveValues(task: DeployTaskRow): string[] {
  if (task.source.kind !== "docker") {
    return [];
  }
  const settings = task.source.settings as unknown as DockerDeploymentSettings;
  const env = Array.isArray(settings.env) ? settings.env : [];
  // Failure text is display-only, so even short values can be replaced safely;
  // preserving a pretty provider error is less important than avoiding an echo.
  const envArgs = Object.fromEntries(
    env
      .filter((row) => typeof row?.value === "string")
      .map((row) => [row.name, row.value])
  );
  return allSensitiveArgValues(envArgs);
}

async function runDirectDeploymentTask(input: {
  kubeconfig: string;
  projectName: string;
  task: DeployTaskRow;
}) {
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.direct_validation_started",
    eventMessage: "Validating direct deployment settings.",
    phase: "plan",
    status: "running",
    stepId: "validate-settings",
    taskId: input.task.id,
  });
  await updateDeployTaskState(input.task.id, {
    phase: "plan",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.plan_created",
    message: "Prepared direct deployment plan.",
    phase: "plan",
  });

  const artifact = generateDirectArtifact(input);
  await updateDeployTaskState(input.task.id, {
    artifactSummary: { artifacts: [artifact] },
    phase: "generate-artifacts",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.artifacts_generated",
    message: "Generated deployment artifacts.",
    phase: "generate-artifacts",
  });
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.direct_validation_completed",
    eventMessage: "Direct deployment settings are ready.",
    phase: "generate-artifacts",
    status: "completed",
    stepId: "validate-settings",
    taskId: input.task.id,
  });

  try {
    await completeTaskWithArtifact({
      artifact,
      kubeconfig: input.kubeconfig,
      task: input.task,
    });
  } catch (error) {
    if (isDeployTaskAbortError(error)) {
      throw error;
    }
    // Scrub any docker env value the apply error echoed (ADR 0042).
    throw attachDeploySensitiveValues(error, directSensitiveValues(input.task));
  }
}

/**
 * Declarations for a named provider template, as a deployment plan over the
 * merged args. A template whose source YAML cannot be fetched or parsed
 * degrades to heuristic-only handling (null) instead of failing a deploy
 * the provider itself would accept; a provider outage surfaces on the
 * deploy call with its real error.
 */
async function templateDeploymentPlanForRun(input: {
  args: Record<string, string>;
  encodedKubeconfig: string;
  sensitiveInputs: readonly SensitiveDeploymentInputShape[];
  taskId: string;
  templateName: string;
}): Promise<DeploymentTaskDeploymentPlan | null> {
  try {
    const templateSource = await getTemplateSource({
      encodedKubeconfig: input.encodedKubeconfig,
      templateName: input.templateName,
    });
    const templateYaml =
      typeof templateSource.templateYaml === "string"
        ? templateSource.templateYaml
        : "";
    if (templateYaml.trim() === "") {
      return null;
    }
    return createSealosTemplateDeploymentPlan({
      deliveryManifest: { args: input.args },
      templateYaml,
    });
  } catch (error) {
    if (isDeployTaskAbortError(error)) {
      throw error;
    }
    // Surface the degrade as a warning on the prepare step instead of a silent
    // task event (ADR 0042): the run proceeds without input validation, so a
    // completed-but-unvalidated deploy still leaves a visible trace.
    await markTimelineStepWithEvent({
      eventKind: "deployment_task.template_declarations_unavailable",
      eventMessage:
        "Couldn't load template input declarations; continuing with the provided values.",
      eventPayload: {
        error: scrubSensitiveText(
          errorMessage(error),
          allSensitiveArgValues(input.args, input.sensitiveInputs)
        ),
      },
      eventSeverity: "warning",
      phase: "plan",
      status: "running",
      stepId: "prepare-template",
      taskId: input.taskId,
    });
    return null;
  }
}

/**
 * The blocking form for a template run: plan-derived inputs (missing plus
 * every sensitive input, US15) plus synthetic secret fields for keys
 * recorded as stripped at create but absent from the fetched declarations
 * (or whenever declarations are unavailable).
 */
function templateBlockingInputs(input: {
  plan: DeploymentTaskDeploymentPlan | null;
  unsatisfiedSensitiveKeys: string[];
}): DeployTaskBlockingInput[] {
  const fromPlan =
    input.plan == null ? [] : blockingInputsFromDeploymentPlan(input.plan);
  const covered = new Set(fromPlan.map((item) => item.key ?? item.id));
  return [
    ...fromPlan,
    ...input.unsatisfiedSensitiveKeys
      .filter((key) => !covered.has(key))
      .map((key) => ({
        id: key,
        key,
        label: key,
        required: true,
        sensitive: true,
        type: "secret" as const,
      })),
  ];
}

function unsatisfiedTemplateSensitiveKeys(input: {
  mergedArgs: Record<string, string>;
  sensitiveKeys: readonly string[];
  shortSensitiveKeys: ReadonlySet<string>;
  sourceArgValues?: Record<string, string>;
  submittedInputValues?: Record<string, string>;
}): string[] {
  return input.sensitiveKeys.filter((key) => {
    const absentFromMemory = !(
      key in (input.sourceArgValues ?? {}) ||
      key in (input.submittedInputValues ?? {})
    );
    return (
      (absentFromMemory && (input.mergedArgs[key]?.trim() ?? "") === "") ||
      input.shortSensitiveKeys.has(key)
    );
  });
}

async function scrubPersistedTemplateSensitiveArgs(input: {
  plan: DeploymentTaskDeploymentPlan | null;
  source: Extract<DeployTaskRow["source"], { kind: "template" }>;
  taskId: string;
}): Promise<void> {
  if (input.plan == null) {
    return;
  }
  const persistedArgs = input.source.args ?? {};
  const scrubbedArgs = withoutSensitiveArgs(persistedArgs, input.plan.inputs);
  if (Object.keys(scrubbedArgs).length === Object.keys(persistedArgs).length) {
    return;
  }
  await updateDeployTaskState(input.taskId, {
    source: { ...input.source, args: scrubbedArgs },
  });
}

async function runTemplateDeploymentTask(input: {
  encodedKubeconfig: string;
  kubeconfig: string;
  projectId: string;
  sourceArgValues?: Record<string, string>;
  submittedInputValues?: Record<string, string>;
  task: DeployTaskRow;
}) {
  if (input.task.source.kind !== "template") {
    throw new Error("Template runner requires a template source.");
  }
  const source = input.task.source;
  const templateName = source.templateName.trim();

  await markTimelineStepWithEvent({
    eventKind: "deployment_task.template_preparation_started",
    eventMessage: "Preparing template deployment.",
    phase: "plan",
    status: "running",
    stepId: "prepare-template",
    taskId: input.task.id,
  });
  await updateDeployTaskState(input.task.id, {
    phase: "plan",
  });

  // Full args exist only in memory (ADR 0037): the persisted source is the
  // stripped copy; create-time values and blocked-input submissions ride in
  // process memory and win over it.
  const mergedArgs = {
    ...(source.args ?? {}),
    ...(input.sourceArgValues ?? {}),
    ...(input.submittedInputValues ?? {}),
  };
  const sourceSensitiveInputs = (source.sensitiveKeys ?? []).map((key) => ({
    key,
    sensitive: true,
  }));
  const plan = await templateDeploymentPlanForRun({
    args: mergedArgs,
    encodedKubeconfig: input.encodedKubeconfig,
    sensitiveInputs: sourceSensitiveInputs,
    taskId: input.task.id,
    templateName,
  });
  const sensitiveInputs = [...sourceSensitiveInputs, ...(plan?.inputs ?? [])];
  const shortSensitiveKeys = new Set(
    shortSensitiveArgKeys(mergedArgs, sensitiveInputs)
  );

  // Runner-side authoritative scrub: template declarations are the source of
  // truth for sensitivity, including fields create-side callers could not see.
  await scrubPersistedTemplateSensitiveArgs({
    plan,
    source,
    taskId: input.task.id,
  });

  // Keys recorded as stripped at create (ADR 0037) whose values this run
  // does not hold in memory: a clone must re-collect them — even when the
  // template's declarations are unavailable — so stripped values are never
  // silently dropped. A non-empty short secret is re-asked because substring
  // scrubbing it would corrupt unrelated persisted output.
  const unsatisfiedSensitiveKeys = unsatisfiedTemplateSensitiveKeys({
    mergedArgs,
    sensitiveKeys: source.sensitiveKeys ?? [],
    shortSensitiveKeys,
    sourceArgValues: input.sourceArgValues,
    submittedInputValues: input.submittedInputValues,
  });
  if (
    (plan?.missingInputKeys?.length ?? 0) > 0 ||
    unsatisfiedSensitiveKeys.length > 0
  ) {
    const blockingInputs = templateBlockingInputs({
      plan,
      unsatisfiedSensitiveKeys,
    });
    await markTimelineStepWithEvent({
      eventKind: "deployment_task.input_required",
      eventMessage: `Deployment requires ${blockingInputs.length} configuration value${blockingInputs.length === 1 ? "" : "s"}.`,
      eventPayload: {
        inputKeys: blockingInputs.map((item) => item.key ?? item.id),
      },
      eventSeverity: "warning",
      phase: "configure",
      status: "blocked",
      stepId: "prepare-template",
      taskId: input.task.id,
      timelineStatus: "blocked",
    });
    // The blocked transition releases the lease and ends this run — it
    // must be the run's final write.
    await deployTaskRequestInputs(input.task.id, {
      blockingInputs,
      phase: "configure",
    });
    return;
  }

  const sensitiveValues = allSensitiveArgValues(mergedArgs, sensitiveInputs);
  assertPersistableSensitiveValues(sensitiveValues);

  // Identity allocation must stay below the blocking-input gate: a blocked
  // run ends above without applying anything, and an identity persisted
  // before that point would read as "reused" on resume — gating off cleanup
  // of the resumed run's first partial apply (ADR 0038 freshness proof).
  const { freshlyAllocated: identityFreshlyAllocated, instanceName } =
    await allocateTemplateInstanceName({
      task: input.task,
      templateName,
    });

  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.plan_created",
    message: "Prepared template deployment plan.",
    phase: "plan",
  });

  try {
    const artifact = generateTemplateArtifact({
      args: mergedArgs,
      instanceName,
      namespace: input.task.namespace,
      projectId: input.projectId,
      templateName,
    });
    await markTimelineStepWithEvent({
      eventKind: "deployment_task.template_preparation_completed",
      eventMessage: "Template deployment is ready.",
      phase: "generate-artifacts",
      status: "completed",
      stepId: "prepare-template",
      taskId: input.task.id,
    });

    await completeTaskWithArtifact({
      artifact,
      completionEventKind: "deployment_task.resources_created",
      completionEventMessage:
        "Template deployment resources were created. Workload readiness continues in Kubernetes.",
      completionRecordMessage: "Template deployment resources created.",
      kubeconfig: input.kubeconfig,
      sensitiveValues,
      task: input.task,
    });
  } catch (error) {
    // An abort is a typed cancellation outcome, never a failure: it must not
    // reach failure cleanup, which deletes partial resources (ADR 0038).
    if (isDeployTaskAbortError(error)) {
      throw error;
    }
    // Readiness timeouts and every other non-apply failure preserve the
    // created resources (ADR 0037); see templateCleanupAllowed.
    if (templateCleanupAllowed(error, { identityFreshlyAllocated })) {
      await cleanupFailedTemplateDeployment({
        encodedKubeconfig: input.encodedKubeconfig,
        instanceName,
        projectId: input.projectId,
        task: input.task,
      });
    }
    // Carry this run's known sensitive values to the terminal failure write so
    // a provider/K8s error that echoed one is scrubbed before persist (ADR 0042).
    throw attachDeploySensitiveValues(error, sensitiveValues);
  }
}

function recordedTemplateInstanceName(task: DeployTaskRow): string {
  return (
    task.artifactSummary.resultIdentities?.templateInstanceName?.trim() ?? ""
  );
}

/**
 * Result-identity contract (ADR 0038): reuse the recorded template instance
 * name when one exists (redeploy converging on preserved resources); a fresh
 * allocation is persisted with a fenced write before any provider call uses
 * it, so an identity can never be allocated and then lost to a crash.
 * `freshlyAllocated` feeds cleanup eligibility: only a fresh identity proves
 * the label selector matches nothing but this run's resources — which is why
 * callers must allocate only after every non-applying early exit (notably the
 * blocking-input gate): an identity persisted by a run that never applied
 * would be misread as reused on resume.
 */
async function allocateTemplateInstanceName(input: {
  task: DeployTaskRow;
  templateName: string;
}): Promise<{ freshlyAllocated: boolean; instanceName: string }> {
  const recorded = recordedTemplateInstanceName(input.task);
  if (recorded) {
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.result_identity_reused",
      message: `Reusing template instance "${recorded}" from the previous run.`,
      payload: { templateInstanceName: recorded },
      phase: "plan",
    });
    return { freshlyAllocated: false, instanceName: recorded };
  }
  const allocated = childResourceName(input.templateName, "template");
  await updateDeployTaskState(input.task.id, {
    artifactSummary: {
      ...input.task.artifactSummary,
      resultIdentities: {
        ...input.task.artifactSummary.resultIdentities,
        templateInstanceName: allocated,
      },
    },
  });
  return { freshlyAllocated: true, instanceName: allocated };
}

function aiSourceKey(task: DeployTaskRow): string {
  switch (task.source.kind) {
    case "github":
      return task.source.repo.url;
    case "prompt":
      return `prompt:${task.id}`;
    default:
      return `${task.source.kind}:${task.id}`;
  }
}

function aiAnalyzeSourceMessage(task: DeployTaskRow): string {
  return task.source.kind === "github"
    ? "Analyzing repository."
    : "Analyzing deployment request.";
}

function aiAnalyzeSourceCompletedMessage(task: DeployTaskRow): string {
  return task.source.kind === "github"
    ? "Repository analysis is complete."
    : "Deployment request analysis is complete.";
}

async function githubTokenForTask(task: DeployTaskRow): Promise<string | null> {
  if (task.source.kind !== "github") {
    return null;
  }
  try {
    return await resolveGithubTokenForDeploymentTask(
      task,
      getGithubOAuthTokenForDeploymentBinding
    );
  } catch (error) {
    throw withDeployFailureDetails(error, {
      reason: "github-authentication",
    });
  }
}

export async function ensureAiDeploymentDevbox(input: {
  deadlineAtMs?: number;
  encodedKubeconfig: string;
  githubToken?: string;
  managedInstanceName?: string;
  kubeconfig: string;
  signal?: AbortSignal;
  task: DeployTaskRow;
}): Promise<Awaited<ReturnType<typeof ensureDeployDevbox>>> {
  try {
    return await ensureDeployDevbox({
      deadlineAtMs: input.deadlineAtMs,
      existingRuntimeName: input.task.runtimeName,
      env:
        input.task.executionMode === "agent" && input.managedInstanceName
          ? {
              SEALAI_CONTRACT_DIR: MANAGED_DEPLOYMENT_CONTRACT_DIR,
              SEALAI_DEPLOY_INSTANCE_NAME: input.managedInstanceName,
              SEALAI_DEPLOY_MODE: "brain-managed",
              SEALAI_DEPLOY_NAMESPACE: input.task.namespace,
              SEALAI_DEPLOY_TASK_ID: input.task.id,
              SEALAI_FIELD_MANAGER: managedDeploymentFieldManager(
                input.task.id
              ),
              SEALAI_INPUTS_PATH: `${MANAGED_DEPLOYMENT_INPUT_ROOT}/${input.task.id}/inputs.json`,
              SEALAI_KUBECONFIG_PATH: MANAGED_DEPLOYMENT_KUBECONFIG_PATH,
              SEALAI_MAX_REPAIR_TURNS: String(
                AGENT_DEPLOY_TIMEOUT_POLICY.maxRepairTurns
              ),
            }
          : undefined,
      githubToken: input.githubToken,
      namespace: input.task.namespace,
      repoUrl: aiSourceKey(input.task),
      resolveGatewayCredentials:
        input.task.source.kind === "github"
          ? async (signal) => {
              try {
                return await resolveGithubCodexGatewayCredentials({
                  encodedKubeconfig: input.encodedKubeconfig,
                  kubeconfig: input.kubeconfig,
                  signal,
                });
              } catch (error) {
                throw withDeployFailureDetails(error, {
                  reason: "ai-proxy-unavailable",
                });
              }
            }
          : undefined,
      signal: input.signal,
      taskId: input.task.id,
    });
  } catch (error) {
    throw withDeployFailureDetails(error, {
      ...(error instanceof DevboxApiError ? { httpStatus: error.status } : {}),
      reason: "deploy-runtime-unavailable",
    });
  }
}

function isAllowedManagedHttpUrl(url: URL, allowedDomain: string): boolean {
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    (url.hostname === allowedDomain ||
      url.hostname.endsWith(`.${allowedDomain}`))
  );
}

async function assertManagedHttpResponseBody(
  response: Response
): Promise<void> {
  const reader = response.body?.getReader();
  if (reader == null) {
    throw new Error("Managed HTTP verification returned an empty body.");
  }
  const first = await reader.read();
  await reader.cancel().catch(() => undefined);
  if (first.done || first.value.byteLength === 0) {
    throw new Error("Managed HTTP verification returned an empty body.");
  }
}

async function probeManagedHttpTarget(input: {
  allowedDomain: string;
  allowedHosts: readonly string[];
  deadlineAtMs: number;
  target: string;
}): Promise<void> {
  let url = new URL(input.target);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (
      !(
        isAllowedManagedHttpUrl(url, input.allowedDomain) &&
        input.allowedHosts.includes(url.hostname.toLowerCase())
      )
    ) {
      throw new Error(
        "Managed HTTP verification target is outside the owned public hosts."
      );
    }
    const remainingMs = Math.max(1, input.deadlineAtMs - Date.now());
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(Math.min(15_000, remainingMs)),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location == null || redirects === 5) {
        throw new Error(
          "Managed HTTP verification exceeded its redirect limit."
        );
      }
      url = new URL(location, url);
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Managed HTTP verification returned ${response.status}.`);
    }
    await assertManagedHttpResponseBody(response);
    return;
  }
}

async function probeManagedServiceTarget(input: {
  allowedHosts: string[];
  deadlineAtMs: number;
  namespace: string;
  runtimeName: string;
  target: string;
  taskId: string;
}): Promise<void> {
  const encoded = Buffer.from(
    JSON.stringify({ allowedHosts: input.allowedHosts, target: input.target }),
    "utf8"
  ).toString("base64");
  const script = [
    'const input = JSON.parse(Buffer.from(process.env.SEALAI_HTTP_PROBE, "base64").toString("utf8"));',
    "let url = new URL(input.target);",
    "const run = async () => {",
    "  for (let redirects = 0; redirects <= 5; redirects += 1) {",
    "    if (url.protocol !== 'http:' || !input.allowedHosts.includes(url.hostname)) throw new Error('service probe target is outside the verified Services');",
    "    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });",
    "    if (response.status >= 300 && response.status < 400) { const location = response.headers.get('location'); if (!location || redirects === 5) throw new Error('service probe redirect limit exceeded'); url = new URL(location, url); continue; }",
    "    if (response.status < 200 || response.status >= 300) throw new Error('service probe returned ' + response.status);",
    "    const reader = response.body && response.body.getReader(); if (!reader) throw new Error('service probe returned an empty body'); const first = await reader.read(); await reader.cancel(); if (first.done || first.value.byteLength === 0) throw new Error('service probe returned an empty body'); process.stdout.write('ok'); return;",
    "  }",
    "};",
    "run().catch((error) => { console.error(error.message); process.exit(1); });",
  ].join(" ");
  await execForOutput({
    command: `SEALAI_HTTP_PROBE=${shellQuote(encoded)} node -e ${shellQuote(script)}`,
    deadlineAtMs: input.deadlineAtMs,
    namespace: input.namespace,
    runtimeName: input.runtimeName,
    taskId: input.taskId,
    timeoutSeconds: deploymentExecTimeoutSeconds({
      capMs: 20_000,
      deadlineAtMs: input.deadlineAtMs,
    }),
  });
}

async function verifyManagedDeploymentWithBrain(input: {
  deadlineAtMs: number;
  instanceName: string;
  kubeconfig: string;
  namespace: string;
  projectId: string;
  report: ManagedVerifyReport;
  runtimeName: string;
  taskId: string;
}): Promise<{
  ok: boolean;
  resources: ManagedVerifyReport["resources"];
  retryable: boolean;
  violations: string[];
}> {
  const resourceMap = new Map<
    string,
    ManagedVerifyReport["resources"][number]
  >();
  const instanceRef = {
    apiVersion: "app.sealos.io/v1",
    kind: "Instance",
    name: input.instanceName,
    namespace: input.namespace,
  };
  const discoveryText = await execForOutput({
    command: buildManagedResourceDiscoveryCommand({
      instanceName: input.instanceName,
      namespace: input.namespace,
      projectId: input.projectId,
    }),
    deadlineAtMs: input.deadlineAtMs,
    namespace: input.namespace,
    runtimeName: input.runtimeName,
    taskId: input.taskId,
    timeoutSeconds: deploymentExecTimeoutSeconds({
      capMs: MANAGED_VERIFICATION_QUERY_BATCH_MS,
      deadlineAtMs: input.deadlineAtMs,
    }),
  });
  const discovery = parseManagedResourceDiscovery(discoveryText);
  for (const resource of [instanceRef, ...input.report.resources]) {
    resourceMap.set(
      [
        resource.apiVersion,
        resource.kind,
        resource.namespace,
        resource.name,
      ].join("|"),
      resource
    );
  }
  for (const resource of discovery.resources) {
    if (resourceMap.size >= 257) {
      break;
    }
    resourceMap.set(
      [
        resource.apiVersion,
        resource.kind,
        resource.namespace,
        resource.name,
      ].join("|"),
      resource
    );
  }
  const observationsText = await execForOutput({
    command: buildManagedResourceObservationCommand([...resourceMap.values()]),
    deadlineAtMs: input.deadlineAtMs,
    namespace: input.namespace,
    runtimeName: input.runtimeName,
    taskId: input.taskId,
    timeoutSeconds: deploymentExecTimeoutSeconds({
      capMs: MANAGED_VERIFICATION_QUERY_BATCH_MS,
      deadlineAtMs: input.deadlineAtMs,
    }),
  });
  const observations = parseManagedResourceObservations(observationsText);
  const resourceResult = verifyManagedResourceObservations({
    instanceName: input.instanceName,
    observations,
    report: input.report,
  });
  const violations = [...resourceResult.violations];
  const httpTargets = input.report.checks.flatMap((check) =>
    check.status === "passed" &&
    (check.kind === "http" || check.kind === "public-access") &&
    check.target
      ? [check.target]
      : []
  );
  const { publicHosts, serviceHosts } =
    managedObservedNetworkHosts(observations);
  if (
    httpTargets.length === 0 &&
    (serviceHosts.length > 0 || publicHosts.length > 0)
  ) {
    violations.push("Managed deployment has no HTTP verification target.");
  }
  for (const target of httpTargets) {
    try {
      const targetUrl = new URL(target);
      if (serviceHosts.includes(targetUrl.hostname)) {
        await probeManagedServiceTarget({
          allowedHosts: serviceHosts,
          deadlineAtMs: input.deadlineAtMs,
          namespace: input.namespace,
          runtimeName: input.runtimeName,
          target,
          taskId: input.taskId,
        });
      } else {
        await probeManagedHttpTarget({
          allowedDomain: apUserDomain(input.kubeconfig),
          allowedHosts: publicHosts,
          deadlineAtMs: input.deadlineAtMs,
          target,
        });
      }
    } catch (error) {
      violations.push(
        error instanceof Error
          ? error.message
          : "Managed HTTP verification failed."
      );
    }
  }
  const deterministicViolation = violations.some(
    (violation) =>
      violation.includes("outside the cluster domain") ||
      violation.includes("outside the owned public hosts") ||
      violation.includes("outside the verified Services") ||
      violation === "Agent verification report did not pass" ||
      violation === "Managed deployment has no HTTP verification target."
  );
  return {
    ok: violations.length === 0,
    resources: managedObservedResourceRefs(observations),
    retryable: violations.length > 0 && !deterministicViolation,
    violations,
  };
}

async function verifyManagedDeploymentUntilDeadline(input: {
  deadlineAtMs: number;
  instanceName: string;
  kubeconfig: string;
  namespace: string;
  projectId: string;
  report: ManagedVerifyReport;
  runtimeName: string;
  taskId: string;
}): Promise<{
  ok: boolean;
  resources: ManagedVerifyReport["resources"];
  violations: string[];
}> {
  let result = await verifyManagedDeploymentWithBrain(input);
  while (!result.ok && result.retryable) {
    const remainingMs = input.deadlineAtMs - Date.now();
    if (remainingMs <= 0) {
      break;
    }
    await abortableSleep(
      Math.min(5000, remainingMs),
      deployTaskRunSignal(input.taskId)
    );
    if (Date.now() >= input.deadlineAtMs) {
      break;
    }
    result = await verifyManagedDeploymentWithBrain(input);
  }
  return {
    ok: result.ok,
    resources: result.resources,
    violations: result.violations,
  };
}

interface ManagedTurnResult {
  control: ManagedDeploymentControl;
  report: ManagedTurnReport;
  sessionId: string;
}

async function runManagedDeploymentTurn(input: {
  brainReviewPath?: string;
  context: GatewayContext;
  deadlineAtMs: number;
  existingSessionId?: string | null;
  inputPath?: string;
  instanceName: string;
  namespace: string;
  outputProgressSignatures: Set<string>;
  previousTurnId?: number;
  projectId: string;
  repairCount: number;
  resumeMode: ManagedDeployResumeMode;
  runtimeName: string;
  task: DeployTaskRow;
  turnCount: number;
}): Promise<ManagedTurnResult> {
  const turnId = input.turnCount + 1;
  const control: ManagedDeploymentControl = {
    ...(input.brainReviewPath === undefined
      ? {}
      : { brainReviewPath: input.brainReviewPath }),
    deadlineAt: new Date(input.deadlineAtMs).toISOString(),
    fieldManager: managedDeploymentFieldManager(input.task.id),
    identity: {
      instanceName: input.instanceName,
      namespace: input.namespace,
      projectId: input.projectId,
    },
    ...(input.inputPath === undefined ? {} : { inputsPath: input.inputPath }),
    maxMutatedResourcesPerTurn: 128,
    maxRepairTurns: AGENT_DEPLOY_TIMEOUT_POLICY.maxRepairTurns,
    mode: "brain-managed",
    mutationAuthorizationPath:
      MANAGED_DEPLOYMENT_MUTATION_AUTHORIZATION_RELATIVE_PATH,
    mutationAuthorizationRequired: false,
    mutationIntentPath: MANAGED_DEPLOYMENT_MUTATION_INTENT_RELATIVE_PATH,
    ...(input.previousTurnId === undefined
      ? {}
      : { previousTurnId: input.previousTurnId }),
    repairTurn: input.repairCount,
    resumeMode: input.resumeMode,
    schemaVersion: 1,
    taskId: input.task.id,
    turnId,
  };
  await updateDeployTaskState(input.task.id, {
    agentRepairCount: input.repairCount,
    agentTurnCount: turnId,
  });
  await writeManagedTurnControl({
    control,
    deadlineAtMs: input.deadlineAtMs,
    namespace: input.namespace,
    runtimeName: input.runtimeName,
    taskId: input.task.id,
  });
  const sessionId = await runDeployTaskGatewayWithOutputProgress({
    context: input.context,
    deadlineAtMs: input.deadlineAtMs,
    existingSessionId: input.existingSessionId,
    namespace: input.namespace,
    pauseOnError: false,
    resumeMode: input.resumeMode,
    runtimeName: input.runtimeName,
    seenSignatures: input.outputProgressSignatures,
    task: input.task,
  });
  const reportContents = await readManagedContract({
    deadlineAtMs: input.deadlineAtMs,
    maxBytes: MANAGED_TURN_REPORT_MAX_BYTES,
    namespace: input.namespace,
    path: MANAGED_DEPLOYMENT_TURN_REPORT_PATH,
    runtimeName: input.runtimeName,
    taskId: input.task.id,
  });
  const report = parseManagedTurnReport(reportContents);
  assertManagedTurnReportForControl(report, control);
  await updateDeployTaskState(input.task.id, {
    agentLastReportDigest: createHash("sha256")
      .update(reportContents)
      .digest("hex"),
  });
  return { control, report, sessionId };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This is the bounded managed-turn state machine; each branch is a protocol outcome.
async function runManagedDeploymentLifecycleCore(input: {
  context: GatewayContext;
  initialDeadlineAtMs: number;
  inputPath?: string;
  instanceName: string;
  kubeconfig: string;
  outputProgressSignatures: Set<string>;
  projectId: string;
  resumeMode: "initial" | "input-submitted";
  runtimeName: string;
  task: DeployTaskRow;
  taskDeadlineAtMs: number;
  values?: Record<string, string>;
}): Promise<void> {
  let turnCount = input.task.agentTurnCount;
  let repairCount = input.task.agentRepairCount;
  let previousTurnId = turnCount > 0 ? turnCount : undefined;
  let sessionId = input.task.gatewaySessionId;
  let resumeMode: ManagedDeployResumeMode = input.resumeMode;
  let applying = input.task.status === "applying";
  let brainReviewPath: string | undefined;
  let remainingVerifyBudgetMs = AGENT_DEPLOY_TIMEOUT_POLICY.verifyMs;

  while (true) {
    const deadlineAtMs =
      resumeMode === "initial" || resumeMode === "input-submitted"
        ? input.initialDeadlineAtMs
        : deploymentPhaseDeadlineAt({
            budgetMs: AGENT_DEPLOY_TIMEOUT_POLICY.repairTurnMs,
            taskDeadlineAtMs: input.taskDeadlineAtMs,
          });
    const turnInputPath =
      input.inputPath != null && input.values != null
        ? await writeManagedInputValues({
            deadlineAtMs,
            namespace: input.task.namespace,
            runtimeName: input.runtimeName,
            taskId: input.task.id,
            turnId: turnCount + 1,
            values: input.values,
          })
        : input.inputPath;
    const result = await runManagedDeploymentTurn({
      brainReviewPath,
      context: input.context,
      deadlineAtMs,
      existingSessionId: sessionId,
      inputPath: turnInputPath,
      instanceName: input.instanceName,
      namespace: input.task.namespace,
      outputProgressSignatures: input.outputProgressSignatures,
      previousTurnId,
      projectId: input.projectId,
      repairCount,
      resumeMode,
      runtimeName: input.runtimeName,
      task: input.task,
      turnCount,
    });
    turnCount = result.control.turnId;
    previousTurnId = turnCount;
    sessionId = result.sessionId;
    brainReviewPath = undefined;
    if (result.report.outcome === "inputs-required") {
      if (applying) {
        throw new Error(
          "Managed deployment requested input after mutation began."
        );
      }
      const requestContents = await readManagedContract({
        deadlineAtMs,
        maxBytes: MANAGED_INPUTS_REQUIRED_MAX_BYTES,
        namespace: input.task.namespace,
        path: MANAGED_DEPLOYMENT_INPUTS_REQUIRED_PATH,
        runtimeName: input.runtimeName,
        taskId: input.task.id,
      });
      const request = parseManagedInputsRequired(requestContents);
      assertManagedContractEnvelope(request, result.control);
      const blockingInputs = managedBlockingInputs(request);
      await updateDeployTaskState(input.task.id, {
        artifactSummary: {
          ...input.task.artifactSummary,
          publicProjectionVersion:
            CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
          resultIdentities: {
            ...input.task.artifactSummary.resultIdentities,
            templateInstanceName: input.instanceName,
          },
        },
      });
      await markTimelineStepWithEvent({
        eventKind: "deployment_task.input_required",
        eventMessage: `Deployment requires ${blockingInputs.length} configuration value${blockingInputs.length === 1 ? "" : "s"}.`,
        eventPayload: { inputKeys: blockingInputs.map((item) => item.key) },
        eventSeverity: "warning",
        phase: "configure",
        status: "blocked",
        stepId: "generate-deployment",
        taskId: input.task.id,
        timelineStatus: "blocked",
      });
      await deployTaskRequestInputs(input.task.id, {
        blockingInputs,
        phase: "configure",
      });
      return;
    }

    if (result.report.outcome === "fatal") {
      throw new Error("Managed deployment Agent reported a fatal outcome.");
    }
    if (!applying && managedTurnOutcomeStartsApplying(result.report.outcome)) {
      await deployTaskBeginApplying(input.task.id);
      applying = true;
    }
    await updateDeployTaskState(input.task.id, { phase: "verify" });
    if (result.report.outcome === "verified") {
      const verifyContents = await readManagedContract({
        deadlineAtMs: input.taskDeadlineAtMs,
        maxBytes: MANAGED_VERIFY_REPORT_MAX_BYTES,
        namespace: input.task.namespace,
        path: MANAGED_DEPLOYMENT_VERIFY_REPORT_PATH,
        runtimeName: input.runtimeName,
        taskId: input.task.id,
      });
      const verifyReport = parseManagedVerifyReport(verifyContents);
      assertManagedVerifyReportForControl(verifyReport, result.control);
      const remainingVerificationAttempts =
        AGENT_DEPLOY_TIMEOUT_POLICY.maxRepairTurns - repairCount + 1;
      const verifySliceMs = Math.floor(
        remainingVerifyBudgetMs / remainingVerificationAttempts
      );
      if (verifySliceMs <= 0) {
        throw new Error(
          "Managed deployment exhausted its verification budget."
        );
      }
      const verifyStartedAtMs = Date.now();
      const verifyDeadlineAtMs = deploymentPhaseDeadlineAt({
        budgetMs: verifySliceMs,
        reserveMs:
          AGENT_DEPLOY_TIMEOUT_POLICY.finalizeMs +
          AGENT_DEPLOY_TIMEOUT_POLICY.operationalSlackMs,
        taskDeadlineAtMs: input.taskDeadlineAtMs,
      });
      const brainVerification = await verifyManagedDeploymentUntilDeadline({
        deadlineAtMs: verifyDeadlineAtMs,
        instanceName: input.instanceName,
        kubeconfig: input.kubeconfig,
        namespace: input.task.namespace,
        projectId: input.projectId,
        report: verifyReport,
        runtimeName: input.runtimeName,
        taskId: input.task.id,
      });
      remainingVerifyBudgetMs = Math.max(
        0,
        remainingVerifyBudgetMs - (Date.now() - verifyStartedAtMs)
      );
      if (brainVerification.ok) {
        await updateDeployTaskState(input.task.id, {
          artifactSummary: {
            ...input.task.artifactSummary,
            publicProjectionVersion:
              CURRENT_AI_ARTIFACT_PUBLIC_PROJECTION_VERSION,
            resources: brainVerification.resources,
            resultIdentities: {
              ...input.task.artifactSummary.resultIdentities,
              templateInstanceName: input.instanceName,
            },
          },
          phase: "verify",
        });
        await markTimelineStepWithEvent({
          eventKind: "deployment_task.resources_ready",
          eventMessage: "Brain independently verified the managed deployment.",
          eventSeverity: "success",
          phase: "verify",
          status: "completed",
          stepId: "create-resources",
          taskId: input.task.id,
        });
        await deployTaskComplete(input.task.id, {
          kind: "deployment_task.completed",
          message: "Managed deployment completed.",
          phase: "completed",
        });
        return;
      }
      await recordDeployTaskEvent(input.task.id, {
        kind: "deployment_task.brain_verification_rejected",
        message: "Brain verification rejected the Agent result.",
        payload: { violationCount: brainVerification.violations.length },
        phase: "verify",
      });
      await execOrThrow({
        command: buildAtomicJsonWriteCommand({
          allowedRoot: MANAGED_DEPLOYMENT_CONTRACT_DIR,
          path: MANAGED_DEPLOYMENT_BRAIN_REVIEW_PATH,
          value: {
            schemaVersion: 1,
            taskId: input.task.id,
            turnId: result.control.turnId,
            violations: brainVerification.violations.slice(0, 128),
          },
        }),
        deadlineAtMs: input.taskDeadlineAtMs,
        namespace: input.task.namespace,
        runtimeName: input.runtimeName,
        taskId: input.task.id,
        timeoutSeconds: deploymentExecTimeoutSeconds({
          capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
          deadlineAtMs: input.taskDeadlineAtMs,
        }),
      });
      if (repairCount >= AGENT_DEPLOY_TIMEOUT_POLICY.maxRepairTurns) {
        throw new Error(
          "Managed deployment failed Brain verification after repair budget was exhausted."
        );
      }
      repairCount += 1;
      brainReviewPath = MANAGED_DEPLOYMENT_BRAIN_REVIEW_RELATIVE_PATH;
      resumeMode = "brain-review-rejected";
      continue;
    }

    if (repairCount >= AGENT_DEPLOY_TIMEOUT_POLICY.maxRepairTurns) {
      throw new Error("Managed deployment exhausted its repair turn budget.");
    }
    repairCount += 1;
    resumeMode = "repair";
  }
}

async function runManagedDeploymentLifecycle(input: {
  context: GatewayContext;
  initialDeadlineAtMs: number;
  instanceName: string;
  kubeconfig: string;
  outputProgressSignatures: Set<string>;
  projectId: string;
  resumeMode: "initial" | "input-submitted";
  runtimeName: string;
  task: DeployTaskRow;
  taskDeadlineAtMs: number;
  values?: Record<string, string>;
}): Promise<void> {
  let inputPath: string | undefined;
  let lifecycleError: unknown = null;
  try {
    if (input.values != null && Object.keys(input.values).length > 0) {
      inputPath = await writeManagedInputValues({
        deadlineAtMs: input.initialDeadlineAtMs,
        namespace: input.task.namespace,
        runtimeName: input.runtimeName,
        taskId: input.task.id,
        turnId: input.task.agentTurnCount + 1,
        values: input.values,
      });
    }
    await runManagedDeploymentLifecycleCore({
      context: input.context,
      initialDeadlineAtMs: input.initialDeadlineAtMs,
      inputPath,
      instanceName: input.instanceName,
      kubeconfig: input.kubeconfig,
      outputProgressSignatures: input.outputProgressSignatures,
      projectId: input.projectId,
      resumeMode: input.resumeMode,
      runtimeName: input.runtimeName,
      task: input.task,
      taskDeadlineAtMs: input.taskDeadlineAtMs,
      values: input.values,
    });
  } catch (error) {
    lifecycleError = error;
    throw error;
  } finally {
    if (inputPath != null) {
      await removeManagedInputValues({
        inputPath,
        namespace: input.task.namespace,
        runtimeName: input.runtimeName,
        taskId: input.task.id,
      }).catch(async (error) => {
        if (lifecycleError == null) {
          await pauseDevbox(
            input.task.namespace,
            input.runtimeName,
            AbortSignal.timeout(DEPLOY_TIMEOUT_POLICY.gatewayCleanupMs)
          ).catch(() => undefined);
          throw error;
        }
        console.warn(
          `[deploy-task] Failed to remove managed input values for ${input.task.id}.`
        );
      });
    }
    if (lifecycleError != null) {
      await pauseDevbox(
        input.task.namespace,
        input.runtimeName,
        AbortSignal.timeout(DEPLOY_TIMEOUT_POLICY.gatewayCleanupMs)
      ).catch(() => undefined);
    }
  }
}

async function cloneAiDeploymentRepository(input: {
  branch: string | null;
  deadlineAtMs: number;
  githubToken?: string;
  namespace: string;
  repoUrl: string;
  runtimeName: string;
  taskId: string;
}): Promise<void> {
  await recordDeployTaskEvent(input.taskId, {
    kind: "deployment_task.workspace_clone_started",
    message: "Cloning repository into deploy workspace.",
    phase: "prepare",
  });
  try {
    await execOrThrow({
      command: cloneWorkspaceCommand({
        branch: input.branch,
        githubToken: input.githubToken,
        repoUrl: input.repoUrl,
      }),
      deadlineAtMs: input.deadlineAtMs,
      namespace: input.namespace,
      runtimeName: input.runtimeName,
      taskId: input.taskId,
      timeoutSeconds: deploymentExecTimeoutSeconds({
        capMs: DEPLOY_TIMEOUT_POLICY.repositoryCloneMs,
        deadlineAtMs: input.deadlineAtMs,
      }),
    });
  } catch (error) {
    throw withDeployFailureDetails(error, {
      reason: "repository-clone-failed",
    });
  }
  await recordDeployTaskEvent(input.taskId, {
    kind: "deployment_task.workspace_clone_ready",
    message: "Repository clone is ready.",
    phase: "prepare",
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This integration orchestrator preserves the legacy Brain path beside the feature-gated managed Agent path.
async function runAiDeploymentTask(input: {
  encodedKubeconfig: string;
  kubeconfig: string;
  submittedInputValues?: Record<string, string>;
  task: DeployTaskRow;
}) {
  if (
    input.task.source.kind !== "github" &&
    input.task.source.kind !== "prompt"
  ) {
    throw new Error(
      `AI runner does not support ${input.task.source.kind} deployments.`
    );
  }
  if (
    input.task.executionMode === "agent" &&
    input.task.source.kind !== "github"
  ) {
    throw new Error(
      "Managed Agent execution only supports GitHub deployments."
    );
  }
  const managedResume =
    input.task.executionMode === "agent" &&
    Object.keys(input.submittedInputValues ?? {}).length > 0;
  const projectId = input.task.projectId?.trim();
  if (input.task.executionMode === "agent" && !projectId) {
    throw new Error(
      "Managed deployment task has no allocated Project identity."
    );
  }
  const managedInstanceName =
    input.task.executionMode === "agent"
      ? (
          await allocateTemplateInstanceName({
            task: input.task,
            templateName:
              input.task.source.kind === "github"
                ? input.task.source.repo.name
                : input.task.id,
          })
        ).instanceName
      : undefined;
  const executionTimeoutPolicy =
    input.task.executionMode === "agent"
      ? AGENT_DEPLOY_TIMEOUT_POLICY
      : DEPLOY_TIMEOUT_POLICY;
  const remainingPhaseBudgetMs =
    input.task.executionMode === "agent"
      ? AGENT_DEPLOY_TIMEOUT_POLICY.repairMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.verifyMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.finalizeMs +
        AGENT_DEPLOY_TIMEOUT_POLICY.operationalSlackMs
      : DEPLOY_TIMEOUT_POLICY.applyMs +
        DEPLOY_TIMEOUT_POLICY.readinessMs +
        DEPLOY_TIMEOUT_POLICY.finalizeMs;

  const taskDeadlineAtMs = deployTaskDeadlineAt({
    leaseClaimedAt: input.task.leaseClaimedAt,
  });
  const prepareDeadlineAtMs = deploymentPhaseDeadlineAt({
    budgetMs: executionTimeoutPolicy.prepareMs,
    reserveMs: executionTimeoutPolicy.generateMs + remainingPhaseBudgetMs,
    taskDeadlineAtMs,
  });

  await updateDeployTaskState(input.task.id, {
    phase: "prepare",
  });
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.prepare_started",
    eventMessage: "Preparing deploy runtime.",
    phase: "prepare",
    status: "running",
    stepId: "prepare-workspace",
    taskId: input.task.id,
  });

  const githubToken = await githubTokenForTask(input.task);
  const prepareSignal = deploymentOperationSignal({
    deadlineAtMs: prepareDeadlineAtMs,
    taskId: input.task.id,
  });
  const devboxDeadlineAtMs = deploymentPhaseDeadlineAt({
    budgetMs: DEPLOY_TIMEOUT_POLICY.devboxReadyMs,
    taskDeadlineAtMs: prepareDeadlineAtMs,
  });
  const devboxSignal = deploymentOperationSignal({
    deadlineAtMs: devboxDeadlineAtMs,
    taskId: input.task.id,
  });
  let runtime: Awaited<ReturnType<typeof ensureAiDeploymentDevbox>>;
  try {
    runtime = await ensureAiDeploymentDevbox({
      deadlineAtMs: devboxDeadlineAtMs,
      encodedKubeconfig: input.encodedKubeconfig,
      githubToken: githubToken ?? undefined,
      kubeconfig: input.kubeconfig,
      managedInstanceName,
      signal: devboxSignal,
      task: input.task,
    });
  } catch (error) {
    throwIfDeploymentOperationAborted({
      deadlineAtMs: devboxDeadlineAtMs,
      signal: devboxSignal,
      taskId: input.task.id,
    });
    throw error;
  }

  await updateDeployTaskState(input.task.id, {
    runtimeName: runtime.name,
    runtimeProvider: "devbox",
    runtimeState: runtime.info.state.phase,
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.runtime_ready",
    message: "Deploy runtime is ready.",
    payload: { runtimeName: runtime.name },
    phase: "prepare",
  });

  if (input.task.source.kind === "github" && !managedResume) {
    await cloneAiDeploymentRepository({
      branch: input.task.source.branch ?? null,
      deadlineAtMs: prepareDeadlineAtMs,
      githubToken: githubToken ?? undefined,
      namespace: input.task.namespace,
      repoUrl: input.task.source.repo.url,
      runtimeName: runtime.name,
      taskId: input.task.id,
    });
  } else if (input.task.source.kind !== "github") {
    await runWithDeployFailureDetails(
      { reason: "deploy-runtime-unavailable" },
      () =>
        execOrThrow({
          command: prepareEmptyWorkspaceCommand(),
          deadlineAtMs: prepareDeadlineAtMs,
          namespace: input.task.namespace,
          runtimeName: runtime.name,
          taskId: input.task.id,
          timeoutSeconds: deploymentExecTimeoutSeconds({
            capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
            deadlineAtMs: prepareDeadlineAtMs,
          }),
        })
    );
  }

  if (!managedResume) {
    await runWithDeployFailureDetails(
      { reason: "deploy-runtime-unavailable" },
      () =>
        execOrThrow({
          command: prepareWorkspaceOutputCommand(),
          deadlineAtMs: prepareDeadlineAtMs,
          namespace: input.task.namespace,
          runtimeName: runtime.name,
          taskId: input.task.id,
          timeoutSeconds: deploymentExecTimeoutSeconds({
            capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
            deadlineAtMs: prepareDeadlineAtMs,
          }),
        })
    );
  }

  const runtimeInfoForBuild = await runWithDeployFailureDetails(
    { reason: "deploy-runtime-unavailable" },
    () =>
      getDevboxWithSecretRetry(
        input.task.namespace,
        runtime.name,
        prepareSignal
      )
  );
  const apiNetworkId = runtimeInfoForBuild.network?.uniqueID?.trim() || null;
  const kubernetesNetworkId =
    apiNetworkId ??
    (await runWithDeployFailureDetails(
      { reason: "build-runtime-unavailable" },
      () =>
        getDevboxNetworkIdFromKubernetes({
          encodedKubeconfig: input.encodedKubeconfig,
          name: runtime.name,
          namespace: input.task.namespace,
          signal: prepareSignal,
        })
    ));
  if (kubernetesNetworkId == null && input.task.source.kind === "github") {
    throw deployFailureError("build-runtime-unavailable");
  }

  if (!managedResume) {
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.skill_install_started",
      message: "Installing deploy skills into workspace.",
      phase: "prepare",
    });
    try {
      await execOrThrow({
        command: buildDeploySkillInstallCommand(
          getDeploySkillSourceFromEnv(process.env)
        ),
        deadlineAtMs: prepareDeadlineAtMs,
        namespace: input.task.namespace,
        runtimeName: runtime.name,
        taskId: input.task.id,
        timeoutSeconds: deploymentExecTimeoutSeconds({
          capMs: DEPLOY_TIMEOUT_POLICY.skillInstallMs,
          deadlineAtMs: prepareDeadlineAtMs,
        }),
      });
    } catch (error) {
      throw withDeployFailureDetails(error, {
        reason: "deploy-skill-install-failed",
      });
    }
  }

  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.workspace_ready",
    message: "Deployment workspace is ready.",
    phase: "prepare",
  });
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.workspace_ready",
    eventMessage: "Deployment workspace is ready.",
    phase: "prepare",
    status: "completed",
    stepId: "prepare-workspace",
    taskId: input.task.id,
  });

  throwIfDeploymentDeadlineElapsed(prepareDeadlineAtMs);
  const generationDeadlineAtMs = deploymentPhaseDeadlineAt({
    budgetMs: executionTimeoutPolicy.generateMs,
    reserveMs: remainingPhaseBudgetMs,
    taskDeadlineAtMs,
  });
  const generationSignal = deploymentOperationSignal({
    deadlineAtMs: generationDeadlineAtMs,
    taskId: input.task.id,
  });
  const writeBuildRuntimeForTurn = async (
    turnDeadlineAtMs: number
  ): Promise<Record<string, unknown> | null> => {
    const contract = buildRuntimeContract({
      deadlineAtMs: turnDeadlineAtMs,
      devbox: runtimeInfoForBuild,
      networkId: kubernetesNetworkId,
    });
    if (contract == null) {
      if (input.task.source.kind === "github") {
        throw deployFailureError("build-runtime-unavailable");
      }
      return null;
    }
    await runWithDeployFailureDetails(
      { reason: "build-runtime-unavailable" },
      () =>
        execOrThrow({
          command: writeBuildRuntimeContractCommand(contract),
          deadlineAtMs: turnDeadlineAtMs,
          namespace: input.task.namespace,
          runtimeName: runtime.name,
          taskId: input.task.id,
          timeoutSeconds: deploymentExecTimeoutSeconds({
            capMs: DEPLOY_TIMEOUT_POLICY.outputReadMs,
            deadlineAtMs: turnDeadlineAtMs,
          }),
        })
    );
    return contract;
  };

  await updateDeployTaskState(input.task.id, { phase: "plan" });
  const latestRuntimeInfo = await runWithDeployFailureDetails(
    { reason: "deploy-runtime-unavailable" },
    () =>
      getDevboxWithSecretRetry(
        input.task.namespace,
        runtime.name,
        generationSignal
      )
  );
  const gatewayContext =
    getCodexGatewayContextFromDevboxInfo(latestRuntimeInfo);
  const outputProgressSignatures = new Set<string>();

  if (gatewayContext == null) {
    throw deployFailureError("gateway-not-exposed");
  }

  if (!managedResume) {
    await markTimelineStepWithEvent({
      eventKind: "deployment_task.source_analysis_started",
      eventMessage: aiAnalyzeSourceMessage(input.task),
      phase: "plan",
      status: "running",
      stepId: "analyze-source",
      taskId: input.task.id,
    });
  }
  const initialTurnDeadlineAtMs = deploymentPhaseDeadlineAt({
    budgetMs: executionTimeoutPolicy.gatewayInitialTurnMs,
    taskDeadlineAtMs: generationDeadlineAtMs,
  });
  const initialBuildRuntime = await writeBuildRuntimeForTurn(
    initialTurnDeadlineAtMs
  );
  if (initialBuildRuntime != null) {
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.build_runtime_ready",
      message: "Build runtime contract is ready.",
      payload: {
        buildDeadlineAt: initialBuildRuntime.buildDeadlineAt,
        buildDeadlineSeconds: initialBuildRuntime.buildDeadlineSeconds,
        devboxName: runtime.name,
        networkSource: apiNetworkId == null ? "kubernetes" : "devbox-api",
        s3Endpoint: initialBuildRuntime.s3Endpoint,
      },
      phase: "plan",
    });
  }
  if (
    input.task.executionMode === "agent" &&
    managedInstanceName != null &&
    projectId != null
  ) {
    await runManagedDeploymentLifecycle({
      context: gatewayContext,
      initialDeadlineAtMs: initialTurnDeadlineAtMs,
      instanceName: managedInstanceName,
      kubeconfig: input.kubeconfig,
      outputProgressSignatures,
      projectId,
      resumeMode: managedResume ? "input-submitted" : "initial",
      runtimeName: runtime.name,
      task: input.task,
      taskDeadlineAtMs,
      values: input.submittedInputValues,
    });
    return;
  }
  await runDeployTaskGatewayWithOutputProgress({
    context: gatewayContext,
    deadlineAtMs: initialTurnDeadlineAtMs,
    namespace: input.task.namespace,
    runtimeName: runtime.name,
    seenSignatures: outputProgressSignatures,
    task: input.task,
  });
  await updateDeployTaskState(input.task.id, { phase: "generate-artifacts" });
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.source_analysis_completed",
    eventMessage: aiAnalyzeSourceCompletedMessage(input.task),
    phase: "generate-artifacts",
    status: "completed",
    stepId: "analyze-source",
    taskId: input.task.id,
  });
  await markDeploymentGenerationStartedIfNeeded({
    seenOutputProgress: outputProgressSignatures,
    taskId: input.task.id,
  });

  const deployOutput = await runWithDeployFailureDetails(
    { reason: "deploy-runtime-unavailable" },
    () =>
      readDeployOutput({
        deadlineAtMs: generationDeadlineAtMs,
        namespace: input.task.namespace,
        runtimeName: runtime.name,
        signal: generationSignal,
      })
  );
  await recordDeployOutputProgressIfPresent({
    output: deployOutput,
    seenSignatures: outputProgressSignatures,
    taskId: input.task.id,
  });
  let finalDeployOutput = completeAiDeploymentOutput(deployOutput);
  if (finalDeployOutput == null) {
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.output_repair_started",
      message:
        "Codex gateway completed without deployment output; requesting a repair turn.",
      phase: "generate-artifacts",
    });
    await markTimelineStepWithEvent({
      eventKind: "deployment_task.output_repair_started",
      eventMessage:
        "Codex gateway completed without deployment output; requesting a repair turn.",
      phase: "generate-artifacts",
      status: "running",
      stepId: "generate-deployment",
      taskId: input.task.id,
    });
    const repairTurnDeadlineAtMs = deploymentPhaseDeadlineAt({
      budgetMs: DEPLOY_TIMEOUT_POLICY.gatewayRepairTurnMs,
      taskDeadlineAtMs: generationDeadlineAtMs,
    });
    await writeBuildRuntimeForTurn(repairTurnDeadlineAtMs);
    await runDeployTaskGatewayWithOutputProgress({
      context: gatewayContext,
      deadlineAtMs: repairTurnDeadlineAtMs,
      namespace: input.task.namespace,
      repairOutput: true,
      runtimeName: runtime.name,
      seenSignatures: outputProgressSignatures,
      task: input.task,
    });
    const repairedDeployOutput = await runWithDeployFailureDetails(
      { reason: "deploy-runtime-unavailable" },
      () =>
        readDeployOutput({
          deadlineAtMs: generationDeadlineAtMs,
          namespace: input.task.namespace,
          runtimeName: runtime.name,
          signal: generationSignal,
        })
    );
    await recordDeployOutputProgressIfPresent({
      output: repairedDeployOutput,
      seenSignatures: outputProgressSignatures,
      taskId: input.task.id,
    });
    finalDeployOutput = completeAiDeploymentOutput(repairedDeployOutput);
  }

  if (finalDeployOutput == null) {
    throw deployFailureError("deployment-output-missing");
  }

  await applyGeneratedAiDeployOutput({
    encodedKubeconfig: input.encodedKubeconfig,
    githubToken: githubToken ?? undefined,
    kubeconfig: input.kubeconfig,
    output: finalDeployOutput,
    task: input.task,
  });
}

/**
 * The runner body for one claimed execution (ADR 0037): invoked by the
 * engine's launch wrapper under a lease, with the kubeconfig and any
 * submitted Blocking Input values held in request-process memory only. Every
 * task-state write inside goes through the fenced handle; the terminal
 * failure transition is the run's last write. Abort errors pass through to
 * the launch wrapper, which resolves them to `cancelled` — never `failed`.
 */
export async function runDeployTask(
  handle: DeployTaskHandle,
  input: StartDeployTaskRunnerInput
): Promise<void> {
  const runStartedAt = new Date();
  const task = await getDeployTaskById(input.taskId);
  if (task == null) {
    throw new Error("Deploy task not found.");
  }

  try {
    const kubeconfig = requireKubeconfig(input);
    const target = await resolveDeploymentTaskTarget(task);
    if (
      task.projectId?.trim() !== target.projectId ||
      task.projectName?.trim() !== target.projectName
    ) {
      await handle.setState({
        projectId: target.projectId,
        projectName: target.projectName,
      });
    }
    const resolvedTask = {
      ...((await getDeployTaskById(task.id)) ?? task),
      // Local duration deadlines must not compare the application clock with
      // PostgreSQL's lease timestamp. The DB reaper remains authoritative.
      leaseClaimedAt: runStartedAt,
    };
    const submittedInputValues = submittedInputStringValues(
      input.submittedInputValues
    );
    if (
      Object.keys(submittedInputValues).length > 0 &&
      resolvedTask.runner.kind === "ai" &&
      resolvedTask.executionMode !== "agent"
    ) {
      const outputJson = outputJsonFromArtifactSummary(resolvedTask);
      if (outputJson == null) {
        throw new Error("Deploy task has no generated deployment output.");
      }
      await applyAiDeploymentFromPreparedOutput({
        args: {
          ...deployTaskStringRecordValue(
            requiredObjectValue(outputJson, "deliveryManifest").args
          ),
          ...deploymentPlanArgsFromTask(resolvedTask),
          ...submittedInputValues,
        },
        encodedKubeconfig: input.encodedKubeconfig ?? "",
        githubToken:
          resolvedTask.source.kind === "github"
            ? ((await githubTokenForTask(resolvedTask)) ?? undefined)
            : undefined,
        kubeconfig,
        outputJson,
        currentBlockingInputs: input.currentBlockingInputs,
        submittedInputKeys: new Set(Object.keys(submittedInputValues)),
        task: resolvedTask,
        templateYaml: requiredStringValue(outputJson, "templateYaml"),
      });
      return;
    }

    switch (resolvedTask.runner.kind) {
      case "direct":
        await runDirectDeploymentTask({
          kubeconfig,
          projectName: target.projectName,
          task: resolvedTask,
        });
        break;
      case "template":
        await runTemplateDeploymentTask({
          encodedKubeconfig: input.encodedKubeconfig ?? "",
          kubeconfig,
          projectId: target.projectId,
          sourceArgValues: input.sourceArgValues,
          submittedInputValues,
          task: resolvedTask,
        });
        break;
      case "ai":
        await runAiDeploymentTask({
          encodedKubeconfig: input.encodedKubeconfig ?? "",
          kubeconfig,
          submittedInputValues,
          task: resolvedTask,
        });
        break;
      default:
        resolvedTask.runner satisfies never;
        break;
    }
  } catch (error) {
    if (isDeployTaskAbortError(error) || handle.outcome() != null) {
      throw error;
    }
    await resolveDeployTaskRunFailure({ error, handle, task });
  }
}

/**
 * The run's single terminal failure write: timeline marking first, then the
 * fenced `failed` transition carrying the aggregated failure details.
 */
async function resolveDeployTaskRunFailure(input: {
  error: unknown;
  handle: DeployTaskHandle;
  task: DeployTaskRow;
}): Promise<void> {
  const { error, handle, task } = input;
  const rawMessage = error instanceof Error ? error.message : String(error);
  const latestTask = (await getDeployTaskById(task.id)) ?? task;

  // Deterministic runners persist their known-value-scrubbed provider error.
  // AI errors can contain arbitrary gateway output, so they fail closed to a
  // reason-code presentation and never persist the raw message (ADR 0042).
  const sensitiveValues = attachedDeploySensitiveValues(error);
  const message = scrubSensitiveText(rawMessage, sensitiveValues);

  const surfacesRaw = deployRunnerSurfacesRawFailure(latestTask.runner);
  const attachedDetails = attachedDeployFailureDetails(error);
  const attachedReason = attachedDeployFailureReason(error);
  const reasonCode =
    attachedReason ??
    (latestTask.runner.kind === "ai"
      ? (aiFailureReason(rawMessage) ?? "unknown")
      : null);
  const reasonMessage = deploymentFailureReason({
    rawMessage: message,
    reasonCode,
    surfacesRaw,
  });
  const persistedMessage = surfacesRaw ? message : reasonMessage;
  const failureDetails: DeployTaskFailureDetails = surfacesRaw
    ? scrubSensitiveJsonValue(
        {
          ...deployFailureDetails({
            error,
            phase: latestTask.phase,
            source: "runDeployTask",
            task: latestTask,
          }),
          ...attachedDetails,
          failureMessage: reasonMessage,
        },
        sensitiveValues
      )
    : {
        failureMessage: reasonMessage,
        ...(typeof attachedDetails.httpStatus === "number"
          ? { httpStatus: attachedDetails.httpStatus }
          : {}),
        reason: reasonCode ?? "unknown",
        ...(attachedDetails.stage === "apply" ||
        attachedDetails.stage === "readiness"
          ? { stage: attachedDetails.stage }
          : {}),
      };

  await markDeployTaskFailureTimeline({
    detailMessage: persistedMessage,
    reasonMessage,
    task: latestTask,
  }).catch(() => false);
  await handle.fail({
    error: persistedMessage,
    event: {
      kind: "deployment_task.failed",
      message: reasonMessage,
      payload: {
        ...(surfacesRaw ? { error: persistedMessage } : {}),
        ...(reasonCode == null ? {} : { reason: reasonCode }),
      },
      phase: latestTask.phase,
    },
    failureDetails,
  });
}
