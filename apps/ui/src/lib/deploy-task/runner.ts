import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import type {
  DatabaseDeploymentChoice,
  DatabaseDeploymentSettings,
} from "@/features/deployment/database-deployer";
import type { DockerDeploymentSettings } from "@/features/deployment/docker-deployer";
import { validateDockerDeploymentSettings } from "@/features/deployment/docker-deployment-settings";
import {
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_PROJECT_ID_LABEL,
  templateDeploymentExtraLabels,
} from "@/lib/brain-labels";
import { renderDbDeploymentYaml } from "@/lib/db-deployment-yaml";
import {
  createDevbox,
  DevboxApiError,
  execDevbox,
  getDevbox,
  listDevboxes,
  refreshDevboxPause,
  resumeDevbox,
} from "@/lib/devbox/client";
import {
  getDevboxArchiveAfterPauseTime,
  getDevboxDefaultImage,
} from "@/lib/devbox/config";
import type { DevboxInfo } from "@/lib/devbox/types";
import { DIRECT_DB_DEPLOYMENT_OPTIONS } from "@/lib/direct-db-deployment-options";
import { renderDockerDeploymentYaml } from "@/lib/docker-deployment-yaml";
import { getGithubAccessToken } from "@/lib/github-oauth/connection-service";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { childResourceName } from "@/lib/project-child-resource-name";
import { createProject, getProject } from "@/lib/project-persistence/projects";
import { applyRenderedTemplateDeployment } from "@/lib/template-k8s-apply";
import { deployTemplateInstance } from "@/lib/template-provider-core";

import {
  blockingInputsFromDeploymentPlan,
  createSealosTemplateDeploymentPlan,
  type DeploymentArtifact,
  deployTaskStringRecordValue,
  prepareBrainManifestArtifact,
  prepareSealosTemplateArtifact,
  sealosTemplateArtifactSummary,
} from "./artifacts";
import { buildRuntimeContract } from "./build-runtime-contract";
import { resultResourceCardsFromArtifactSummary } from "./direct-timeline";
import { deployTaskFailureSummary } from "./failure-summary";
import {
  DEPLOY_GATEWAY_MODEL,
  type GatewayContext,
  getCodexGatewayContextFromDevboxInfo,
  runDeployTaskGateway,
} from "./gateway";
import { deployOutputProgressSummary } from "./output-progress";
import {
  isResultReadinessTerminalError,
  observeDeploymentResultCardReadiness,
  resultReadinessLabel,
  waitingForResultObservationStatus,
} from "./result-readiness";
import { DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS } from "./runtime-config";
import type {
  DeployTaskArtifactSummary,
  DeployTaskEventPayload,
  DeployTaskRow,
} from "./schema";
import {
  getDeployTaskById,
  getDeployTaskTimelineSnapshot,
  recordDeployTaskEvent,
  updateDeployTaskState,
  updateDeployTaskTimeline,
} from "./service";
import {
  appendCardEvent,
  appendStepEvent,
  applyDeploymentOutputProgressToTimeline,
  applyResultResourceTimeout,
  type DeploymentResultResourceCard,
  deploymentTimelineFailureStepId,
  deploymentTimelineResultReadinessReached,
  markTimelineStep,
  updateTimelineStatus,
  upsertResultResourceCard,
} from "./timeline";
import { deploymentTaskTimelineFromTaskRecord } from "./timeline-storage";

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
const SKILL_INSTALL_TIMEOUT_SECONDS = 300;
const READ_OUTPUT_TIMEOUT_SECONDS = 30;
const DEPLOY_OUTPUT_PROGRESS_POLL_MS = 15_000;
const DIRECT_AP_READINESS_POLL_MS = 5000;
const DIRECT_AP_READINESS_DEFAULT_TIMEOUT_MS = 10 * 60_000;
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
  encodedKubeconfig?: string;
  submittedInputValues?: Record<string, unknown>;
  taskId: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    compactEnvValue(process.env.SEALOS_CERT_SECRET_NAME) ??
    compactEnvValue(process.env.SEALOS_CERT_SECRET) ??
    undefined
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
  });
  return nestedStringValue(result, ["status", "network", "uniqueID"]);
}

async function applyDeploymentArtifact(input: {
  artifact: DeploymentArtifact;
  githubToken?: string;
  kubeconfig: string;
  task: DeployTaskRow;
}): Promise<{
  artifactSummary: DeployTaskArtifactSummary;
  notes: string;
}> {
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
            dedupeKey: input.eventKind,
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
  errorMessage: string;
  failureMessage: string;
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
    eventMessage: input.failureMessage,
    eventPayload: { error: input.errorMessage },
    eventReason: "DeploymentTaskFailed",
    eventSeverity: "error",
    phase: input.task.phase,
    status: "failed",
    stepId,
    taskId: input.task.id,
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
    });
    await upsertResultTimelineCard({
      card: observed.card,
      eventMessage: observed.eventMessage,
      eventReason: observed.eventReason,
      eventSeverity: observed.eventSeverity,
      taskId: input.taskId,
    });

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
      latestStatus: waitingForResultObservationStatus(input.card, error),
      running: !input.card.required,
      status: "unknown",
    };
  }
}

async function waitForRequiredResultCards(input: {
  cards: DeploymentResultResourceCard[];
  failOnTimeout?: boolean;
  kubeconfig: string;
  taskId: string;
}): Promise<boolean> {
  const failOnTimeout = input.failOnTimeout ?? true;
  const startedAt = Date.now();
  const timeoutMs = directApReadinessTimeoutMs();
  let latestStatus = "waiting for required result resource observation";
  const latestStatusByCard = new Map<string, string>();
  const statusByCard = new Map<
    string,
    DeploymentResultResourceCard["status"]
  >();

  while (Date.now() - startedAt <= timeoutMs) {
    let requiredCardsRunning = true;

    for (const card of input.cards) {
      const observed = await observeResultCardReadiness({
        card,
        kubeconfig: input.kubeconfig,
        taskId: input.taskId,
      });
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
        return true;
      }
    }

    await sleep(DIRECT_AP_READINESS_POLL_MS);
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
          failRequired: failOnTimeout,
          lastObservedStatus: latestStatusByCard.get(card.id) ?? latestStatus,
          stepId: "create-resources",
          updatedAt: now,
        }),
    });
  }

  if (!failOnTimeout) {
    return false;
  }

  throw new Error(
    `Timed out waiting for required result resource readiness (${latestStatus}).`
  );
}

function codexGatewayEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const apiKey =
    compactEnvValue(process.env.CODEX_GATEWAY_OPENAI_API_KEY) ??
    compactEnvValue(process.env.SYSTEM_OPENAI_API_KEY);
  const baseUrl =
    compactEnvValue(process.env.CODEX_GATEWAY_OPENAI_BASE_URL) ??
    compactEnvValue(process.env.SYSTEM_OPENAI_API_BASE_URL);
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
  "id" | "namespace" | "projectId" | "projectName" | "target"
>;

function deployFailureDetails(input: {
  error: unknown;
  phase: DeployTaskRow["phase"];
  source: string;
  task: DeployTaskRow;
}): Record<string, unknown> {
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

  await updateDeployTaskState(task.id, {
    phase: "resolve-target",
    status: "running",
  });
  await recordDeployTaskEvent(task.id, {
    kind: "deployment_task.target_resolve_started",
    message: "Resolving deployment target.",
    phase: "resolve-target",
  });

  if (task.target.kind === "newProject") {
    const project = await createProject({
      description: task.target.description,
      displayName: task.target.displayName,
      namespace: task.namespace,
    });
    await updateDeployTaskState(task.id, {
      projectId: project.id,
      projectName: project.id,
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deployment_task.target_resolved",
      message: `Created Project "${project.displayName}".`,
      payload: { projectId: project.id },
      phase: "resolve-target",
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
  await updateDeployTaskState(task.id, {
    projectId: project.id,
    projectName,
  });
  await recordDeployTaskEvent(task.id, {
    kind: "deployment_task.target_resolved",
    message: `Resolved Project "${project.displayName}".`,
    payload: { projectId: project.id },
    phase: "resolve-target",
  });
  return {
    createdProject: false,
    projectId: project.id,
    projectName,
  };
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
          routingDomain: routingDomainFromKubeconfig(input.kubeconfig),
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

async function generateTemplateArtifact(input: {
  encodedKubeconfig: string;
  instanceName: string;
  projectId: string;
  task: DeployTaskRow;
  templateName: string;
}): Promise<DeploymentArtifact> {
  if (input.task.source.kind !== "template") {
    throw new Error("Template runner requires a template source.");
  }
  const deployed = await deployTemplateInstance({
    args: input.task.source.args,
    encodedKubeconfig: input.encodedKubeconfig,
    extraLabels: templateDeploymentExtraLabels({
      instanceName: input.instanceName,
      projectId: input.projectId,
      templateName: input.templateName,
    }),
    instanceName: input.instanceName,
    templateName: input.templateName,
  });
  return {
    instanceName: deployed.instanceName,
    kind: "template-instance",
    resources: deployed.resources,
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
      results.push({ error: errorMessage(error), kind, ok: false });
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

function devboxStateLabel(info: DevboxInfo | null): string {
  if (info == null) {
    return "unknown";
  }
  return (
    [info.state.phase, info.state.status]
      .map((value) => value.trim())
      .filter((value) => value !== "")
      .join("/") || "unknown"
  );
}

async function getDevboxWithSecretRetry(
  authNamespace: string,
  name: string
): Promise<DevboxInfo> {
  let attempt = 0;

  while (true) {
    try {
      return (await getDevbox(authNamespace, name)).data;
    } catch (error) {
      if (
        !isDevboxSecretPendingError(error) ||
        attempt >= DEVBOX_SECRET_READY_MAX_RETRIES
      ) {
        throw error;
      }
      attempt += 1;
      await sleep(DEVBOX_SECRET_READY_RETRY_DELAY_MS);
    }
  }
}

async function waitForRunningDevbox(input: {
  name: string;
  namespace: string;
  taskId?: string;
}): Promise<DevboxInfo> {
  const startedAt = Date.now();
  let lastInfo: DevboxInfo | null = null;
  let lastError: unknown;
  let lastEventAt = startedAt;

  while (Date.now() - startedAt < DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS) {
    try {
      const info = await getDevboxWithSecretRetry(input.namespace, input.name);
      lastInfo = info;
      lastError = undefined;
      if (info.state.phase === "Running") {
        return info;
      }
    } catch (error) {
      if (!isDevboxRuntimePendingError(error)) {
        throw error;
      }
      lastError = error;
    }

    const now = Date.now();
    if (
      input.taskId != null &&
      now - lastEventAt >= DEVBOX_RUNTIME_WAIT_EVENT_MS
    ) {
      lastEventAt = now;
      const elapsedSeconds = Math.round((now - startedAt) / 1000);
      const state = devboxStateLabel(lastInfo);
      await updateDeployTaskState(input.taskId, {
        runtimeName: input.name,
        runtimeProvider: "devbox",
        runtimeState: state,
      });
      await recordDeployTaskEvent(input.taskId, {
        kind: "deployment_task.runtime_waiting",
        message: `Still waiting for deploy Devbox runtime (${elapsedSeconds}s, state: ${state}).`,
        payload: {
          elapsedSeconds,
          lastError: lastError instanceof Error ? lastError.message : null,
          runtimeName: input.name,
          state,
        },
        phase: "prepare",
      });
    }
    await sleep(DEVBOX_RUNTIME_READY_POLL_MS);
  }

  const state = devboxStateLabel(lastInfo);
  const lastErrorMessage =
    lastError instanceof Error ? ` Last error: ${lastError.message}` : "";
  throw new Error(
    `Timed out waiting for deploy Devbox runtime after ${Math.round(
      DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS / 1000
    )}s (last state: ${state}).${lastErrorMessage}`
  );
}

async function ensureRunningDevbox(
  authNamespace: string,
  name: string,
  taskId?: string
): Promise<DevboxInfo> {
  const info = await getDevboxWithSecretRetry(authNamespace, name);
  if (info.state.phase === "Running") {
    return info;
  }

  try {
    await resumeDevbox(authNamespace, name);
  } catch (error) {
    if (!(error instanceof DevboxApiError && error.status === 409)) {
      throw error;
    }
  }

  return await waitForRunningDevbox({
    name,
    namespace: authNamespace,
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

function installSkillsCommand(): string {
  return [
    "set -euo pipefail",
    `workspace_dir=${shellQuote(DEPLOY_WORKSPACE_DIR)}`,
    'agent_skill_marker="$workspace_dir/.agents/skills/sealos-deploy/SKILL.md"',
    'codex_skill_marker="$workspace_dir/.codex/skills/sealos-deploy/SKILL.md"',
    'if [ ! -f "$agent_skill_marker" ] && [ ! -f "$codex_skill_marker" ]; then',
    "if command -v npx >/dev/null 2>&1; then",
    '  cd "$workspace_dir"',
    "  timeout 120 npx --yes skills add https://github.com/zjy365/sealos-skills/tree/sandbox-skill-lite-preview -y",
    "else",
    "  printf 'ERROR: npx is required to install sealos-deploy skill\\n' >&2",
    "  exit 1",
    "fi",
    "fi",
    'if [ ! -f "$agent_skill_marker" ] && [ ! -f "$codex_skill_marker" ]; then',
    "  printf 'ERROR: sealos-deploy skill not found after install\\n' >&2",
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
  existingRuntimeName?: string | null;
  githubToken?: string;
  namespace: string;
  repoUrl: string;
  taskId: string;
}): Promise<{ info: DevboxInfo; name: string }> {
  const existingRuntimeName = input.existingRuntimeName?.trim();
  if (existingRuntimeName) {
    const info = await ensureRunningDevbox(
      input.namespace,
      existingRuntimeName,
      input.taskId
    );
    await refreshDevboxPause(input.namespace, existingRuntimeName, {
      pauseAt: getPauseAt(),
    });
    return { info, name: existingRuntimeName };
  }

  const hash = runtimeHash({
    namespace: input.namespace,
    sourceKey: input.repoUrl,
    taskId: input.taskId,
  });
  const name = runtimeName(hash);
  const upstreamID = runtimeUpstreamId(hash);
  const existing = (await listDevboxes(input.namespace, upstreamID)).data
    .items[0];

  if (existing != null) {
    const info = await ensureRunningDevbox(
      input.namespace,
      existing.name,
      input.taskId
    );
    await refreshDevboxPause(input.namespace, existing.name, {
      pauseAt: getPauseAt(),
    });
    return { info, name: existing.name };
  }

  await createDevbox(input.namespace, {
    archiveAfterPauseTime: getDevboxArchiveAfterPauseTime(),
    env: {
      ...codexGatewayEnv(),
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
    upstreamID,
  });

  const info = await waitForRunningDevbox({
    name,
    namespace: input.namespace,
    taskId: input.taskId,
  });
  return { info, name };
}

async function execOrThrow(input: {
  command: string;
  namespace: string;
  runtimeName: string;
  timeoutSeconds?: number;
}): Promise<void> {
  let attempt = 0;

  while (true) {
    try {
      const result = (
        await execDevbox(input.namespace, input.runtimeName, {
          command: ["bash", "-lc", input.command],
          timeoutSeconds: input.timeoutSeconds,
        })
      ).data;
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim());
      }
      return;
    } catch (error) {
      if (
        !isDevboxSdkPendingError(error) ||
        attempt >= DEVBOX_SDK_READY_MAX_RETRIES
      ) {
        throw error;
      }
      attempt += 1;
      await sleep(DEVBOX_SDK_READY_RETRY_DELAY_MS);
    }
  }
}

async function readDeployOutput(input: {
  allowPartial?: boolean;
  namespace: string;
  runtimeName: string;
}): Promise<Record<string, unknown> | null> {
  const result = (
    await execDevbox(input.namespace, input.runtimeName, {
      command: [
        "bash",
        "-lc",
        readDeployOutputCommand({ allowPartial: input.allowPartial }),
      ],
      timeoutSeconds: READ_OUTPUT_TIMEOUT_SECONDS,
    })
  ).data;

  if (result.exitCode !== 0 || result.stdout.trim() === "") {
    return null;
  }

  const parsed = JSON.parse(result.stdout) as unknown;
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

async function monitorDeployOutputProgress(input: {
  namespace: string;
  runtimeName: string;
  seenSignatures: Set<string>;
  stop: Promise<void>;
  taskId: string;
}): Promise<void> {
  while (true) {
    try {
      const output = await readDeployOutput({
        allowPartial: true,
        namespace: input.namespace,
        runtimeName: input.runtimeName,
      });
      const summary = deployOutputProgressSummary(output);
      if (summary != null) {
        const signature = JSON.stringify(summary);
        if (!input.seenSignatures.has(signature)) {
          input.seenSignatures.add(signature);
          await recordDeployOutputProgress({
            summary,
            taskId: input.taskId,
          });
        }
        if (summary.complete === true) {
          return;
        }
      }
    } catch {
      // Progress polling is best-effort; the gateway turn remains authoritative.
    }

    const nextTick = sleep(DEPLOY_OUTPUT_PROGRESS_POLL_MS);
    const shouldStop = await Promise.race([
      input.stop.then(() => true),
      nextTick.then(() => false),
    ]);
    if (shouldStop) {
      return;
    }
  }
}

async function runDeployTaskGatewayWithOutputProgress(input: {
  context: GatewayContext;
  namespace: string;
  repairOutput?: boolean;
  runtimeName: string;
  seenSignatures: Set<string>;
  task: DeployTaskRow;
}): Promise<void> {
  let stopMonitor!: () => void;
  const stop = new Promise<void>((resolve) => {
    stopMonitor = resolve;
  });
  const monitor = monitorDeployOutputProgress({
    namespace: input.namespace,
    runtimeName: input.runtimeName,
    seenSignatures: input.seenSignatures,
    stop,
    taskId: input.task.id,
  });

  try {
    await runDeployTaskGateway({
      context: input.context,
      repairOutput: input.repairOutput,
      task: input.task,
    });
  } finally {
    stopMonitor();
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

async function completeTaskWithArtifact(input: {
  artifact: DeploymentArtifact;
  artifactSummaryExtras?: Partial<DeployTaskArtifactSummary>;
  completionEventMessage?: string;
  completionEventKind?: string;
  completionRecordMessage?: string;
  failOnResultReadinessTimeout?: boolean;
  githubToken?: string;
  kubeconfig: string;
  outputJson?: Record<string, unknown>;
  task: DeployTaskRow;
}) {
  await updateDeployTaskState(input.task.id, {
    phase: "apply",
    status: "applying",
  });
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
  try {
    applied = await applyDeploymentArtifact({
      artifact: input.artifact,
      githubToken: input.githubToken,
      kubeconfig: input.kubeconfig,
      task: input.task,
    });
  } catch (error) {
    await updateDeployTaskState(input.task.id, {
      failureDetails: {
        ...deployFailureDetails({
          error,
          phase: "apply",
          source: "applyDeploymentArtifact",
          task: input.task,
        }),
        artifactKind: input.artifact.kind,
        resourceCount:
          "resources" in input.artifact &&
          Array.isArray(input.artifact.resources)
            ? input.artifact.resources.length
            : undefined,
        templateName:
          input.artifact.kind === "sealos-template"
            ? input.artifact.templateName
            : undefined,
      },
    });
    throw error;
  }

  await updateDeployTaskState(input.task.id, {
    artifactSummary: {
      ...applied.artifactSummary,
      ...(input.artifactSummaryExtras ?? {}),
      notes: applied.notes,
      ...(input.outputJson === undefined
        ? {}
        : { outputJson: input.outputJson }),
    },
    phase: "apply",
    status: "applying",
  });

  const resultCards = resultResourceCardsFromArtifactSummary(
    applied.artifactSummary
  );
  for (const card of resultCards) {
    await upsertResultTimelineCard({
      card,
      eventMessage: `${resultReadinessLabel(card)} result resource was created.`,
      eventReason: "ResultResourceKnown",
      taskId: input.task.id,
    });
  }

  if (resultCards.some((card) => card.required)) {
    const ready = await waitForRequiredResultCards({
      cards: resultCards,
      failOnTimeout: input.failOnResultReadinessTimeout ?? true,
      kubeconfig: input.kubeconfig,
      taskId: input.task.id,
    });
    if (!ready) {
      await recordDeployTaskEvent(input.task.id, {
        kind: "deployment_task.result_readiness_timeout",
        message:
          "Required deployment result resources were created but did not all become ready before timeout.",
        payload: { artifactSummary: applied.artifactSummary },
        phase: "apply",
      });
    }
  }

  await markTimelineStepWithEvent({
    eventKind:
      input.completionEventKind ?? "deployment_task.result_readiness_reached",
    eventMessage:
      input.completionEventMessage ??
      "Required deployment result resources are running.",
    phase: "completed",
    status: "completed",
    stepId: "create-resources",
    taskId: input.task.id,
  });
  await updateDeployTaskState(input.task.id, {
    phase: "completed",
    status: "completed",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.completed",
    message: input.completionRecordMessage ?? "Deployment task completed.",
    payload: { artifactSummary: applied.artifactSummary },
    phase: "completed",
  });
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
  await updateDeployTaskState(input.task.id, {
    artifactSummary: input.summary,
    blockingInputs,
    phase: "configure",
    status: "blocked",
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
    stepId: "generate-deployment",
    taskId: input.task.id,
    timelineStatus: "blocked",
  });
}

async function blockForMissingAiDeploymentOutput(task: DeployTaskRow) {
  await updateDeployTaskState(task.id, {
    artifactSummary: {
      notes: "Codex gateway completed without deployment output.",
    },
    phase: "generate-artifacts",
    status: "blocked",
  });
  await recordDeployTaskEvent(task.id, {
    kind: "deployment_task.output_missing",
    message: "Codex gateway completed without deployment output.",
    phase: "generate-artifacts",
  });
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.output_missing",
    eventMessage: "Codex gateway completed without deployment output.",
    phase: "generate-artifacts",
    status: "blocked",
    stepId: "generate-deployment",
    taskId: task.id,
  });
}

async function applyAiDeploymentFromPreparedOutput(input: {
  args: Record<string, string>;
  encodedKubeconfig: string;
  githubToken?: string;
  kubeconfig: string;
  outputJson: Record<string, unknown>;
  task: DeployTaskRow;
}) {
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
      routingDomain: routingDomainFromKubeconfig(input.kubeconfig),
      task: input.task,
      templateYaml: requiredStringValue(input.outputJson, "templateYaml"),
    });
  } catch (error) {
    const plan = input.task.artifactSummary.deploymentPlan;
    if (plan != null) {
      await updateDeployTaskState(input.task.id, {
        blockingInputs: blockingInputsFromDeploymentPlan(plan),
        phase: "configure",
        status: "blocked",
      });
    }
    throw error;
  }
  const deploymentPlan =
    input.task.artifactSummary.deploymentPlan == null
      ? undefined
      : {
          ...input.task.artifactSummary.deploymentPlan,
          args: input.args,
        };
  const summary = {
    ...sealosTemplateArtifactSummary({ artifact }),
    ...(deploymentPlan == null ? {} : { deploymentPlan }),
    outputJson: input.outputJson,
  };
  await updateDeployTaskState(input.task.id, {
    artifactSummary: summary,
    blockingInputs: [],
    phase: "configure",
    status: "running",
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

  try {
    await completeTaskWithArtifact({
      artifact,
      artifactSummaryExtras:
        deploymentPlan == null ? undefined : { deploymentPlan },
      githubToken: input.githubToken,
      kubeconfig: input.kubeconfig,
      outputJson: input.outputJson,
      task: input.task,
    });
  } catch (error) {
    await cleanupFailedTemplateDeployment({
      encodedKubeconfig: input.encodedKubeconfig,
      instanceName: artifact.instanceName,
      projectId: input.task.projectId ?? artifact.instanceName,
      task: input.task,
    });
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
  const deploymentPlan = createSealosTemplateDeploymentPlan({
    deliveryManifest,
    templateYaml: requiredStringValue(input.output, "templateYaml"),
  });
  const buildResult = requiredObjectValue(input.output, "buildResult");
  const baseSummary: DeployTaskArtifactSummary = {
    buildResult,
    deliveryManifest,
    deploymentPlan,
    outputJson: input.output,
  };
  if ((deploymentPlan.missingInputKeys?.length ?? 0) > 0) {
    await updateDeployTaskState(input.task.id, {
      artifactSummary: baseSummary,
      phase: "generate-artifacts",
    });
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.artifacts_generated",
      message: "Generated Sealos template deployment artifact.",
      payload: { requiredInputs: deploymentPlan.missingInputKeys },
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
    encodedKubeconfig: input.encodedKubeconfig,
    githubToken: input.githubToken ?? undefined,
    kubeconfig: input.kubeconfig,
    outputJson: input.output,
    task: input.task,
  });
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
    status: "running",
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

  await completeTaskWithArtifact({
    artifact,
    kubeconfig: input.kubeconfig,
    task: input.task,
  });
}

async function runTemplateDeploymentTask(input: {
  encodedKubeconfig: string;
  kubeconfig: string;
  projectId: string;
  task: DeployTaskRow;
}) {
  if (input.task.source.kind !== "template") {
    throw new Error("Template runner requires a template source.");
  }
  const templateName = input.task.source.templateName.trim();
  const instanceName = childResourceName(templateName, "template");

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
    status: "running",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.plan_created",
    message: "Prepared template deployment plan.",
    phase: "plan",
  });

  try {
    const artifact = await generateTemplateArtifact({
      encodedKubeconfig: input.encodedKubeconfig,
      instanceName,
      projectId: input.projectId,
      task: input.task,
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
      failOnResultReadinessTimeout: false,
      kubeconfig: input.kubeconfig,
      task: input.task,
    });
  } catch (error) {
    await cleanupFailedTemplateDeployment({
      encodedKubeconfig: input.encodedKubeconfig,
      instanceName,
      projectId: input.projectId,
      task: input.task,
    });
    throw error;
  }
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

async function runAiDeploymentTask(input: {
  encodedKubeconfig: string;
  kubeconfig: string;
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

  await updateDeployTaskState(input.task.id, {
    phase: "prepare",
    status: "running",
  });
  await markTimelineStepWithEvent({
    eventKind: "deployment_task.prepare_started",
    eventMessage: "Preparing deploy runtime.",
    phase: "prepare",
    status: "running",
    stepId: "prepare-workspace",
    taskId: input.task.id,
  });

  const githubToken =
    input.task.source.kind === "github"
      ? await getGithubAccessToken(input.task.namespace)
      : null;

  const runtime = await ensureDeployDevbox({
    existingRuntimeName: input.task.runtimeName,
    githubToken: githubToken ?? undefined,
    namespace: input.task.namespace,
    repoUrl: aiSourceKey(input.task),
    taskId: input.task.id,
  });

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

  if (input.task.source.kind === "github") {
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.workspace_clone_started",
      message: "Cloning repository into deploy workspace.",
      phase: "prepare",
    });
    await execOrThrow({
      command: cloneWorkspaceCommand({
        branch: input.task.source.branch ?? null,
        githubToken: githubToken ?? undefined,
        repoUrl: input.task.source.repo.url,
      }),
      namespace: input.task.namespace,
      runtimeName: runtime.name,
      timeoutSeconds: SKILL_INSTALL_TIMEOUT_SECONDS,
    });
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.workspace_clone_ready",
      message: "Repository clone is ready.",
      phase: "prepare",
    });
  } else {
    await execOrThrow({
      command: prepareEmptyWorkspaceCommand(),
      namespace: input.task.namespace,
      runtimeName: runtime.name,
      timeoutSeconds: READ_OUTPUT_TIMEOUT_SECONDS,
    });
  }

  await execOrThrow({
    command: prepareWorkspaceOutputCommand(),
    namespace: input.task.namespace,
    runtimeName: runtime.name,
    timeoutSeconds: READ_OUTPUT_TIMEOUT_SECONDS,
  });

  const runtimeInfoForBuild = await getDevboxWithSecretRetry(
    input.task.namespace,
    runtime.name
  );
  const apiNetworkId = runtimeInfoForBuild.network?.uniqueID?.trim() || null;
  const kubernetesNetworkId =
    apiNetworkId ??
    (await getDevboxNetworkIdFromKubernetes({
      encodedKubeconfig: input.encodedKubeconfig,
      name: runtime.name,
      namespace: input.task.namespace,
    }));
  const buildRuntime = buildRuntimeContract({
    devbox: runtimeInfoForBuild,
    networkId: kubernetesNetworkId,
  });
  if (buildRuntime == null && input.task.source.kind === "github") {
    await updateDeployTaskState(input.task.id, {
      artifactSummary: {
        notes:
          "Deploy runtime does not expose a DevBox S3 endpoint for kaniko build context.",
      },
      phase: "prepare",
      status: "blocked",
    });
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.build_runtime_unavailable",
      message:
        "Deploy runtime does not expose a DevBox S3 endpoint for kaniko build context.",
      payload: { runtimeName: runtime.name },
      phase: "prepare",
    });
    await markTimelineStepWithEvent({
      eventKind: "deployment_task.build_runtime_unavailable",
      eventMessage:
        "Deploy runtime does not expose a DevBox S3 endpoint for kaniko build context.",
      phase: "prepare",
      status: "blocked",
      stepId: "prepare-workspace",
      taskId: input.task.id,
    });
    return;
  }
  if (buildRuntime != null) {
    await execOrThrow({
      command: writeBuildRuntimeContractCommand(buildRuntime),
      namespace: input.task.namespace,
      runtimeName: runtime.name,
      timeoutSeconds: READ_OUTPUT_TIMEOUT_SECONDS,
    });
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.build_runtime_ready",
      message: "Build runtime contract is ready.",
      payload: {
        devboxName: runtime.name,
        networkSource: apiNetworkId == null ? "kubernetes" : "devbox-api",
        s3Endpoint: buildRuntime.s3Endpoint,
      },
      phase: "prepare",
    });
  }

  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.skill_install_started",
    message: "Installing deploy skills into workspace.",
    phase: "prepare",
  });
  await execOrThrow({
    command: installSkillsCommand(),
    namespace: input.task.namespace,
    runtimeName: runtime.name,
    timeoutSeconds: SKILL_INSTALL_TIMEOUT_SECONDS,
  });

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

  const latestRuntimeInfo = await getDevboxWithSecretRetry(
    input.task.namespace,
    runtime.name
  );
  const gatewayContext =
    getCodexGatewayContextFromDevboxInfo(latestRuntimeInfo);
  const outputProgressSignatures = new Set<string>();

  if (gatewayContext == null) {
    await updateDeployTaskState(input.task.id, {
      phase: "plan",
      status: "blocked",
    });
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.gateway_unavailable",
      message:
        "Workspace is ready, but the Devbox did not expose a Codex gateway URL.",
      phase: "plan",
    });
    await markTimelineStepWithEvent({
      eventKind: "deployment_task.gateway_unavailable",
      eventMessage:
        "Workspace is ready, but the Devbox did not expose a Codex gateway URL.",
      phase: "plan",
      status: "blocked",
      stepId: "analyze-source",
      taskId: input.task.id,
    });
    return;
  }

  await markTimelineStepWithEvent({
    eventKind: "deployment_task.source_analysis_started",
    eventMessage: aiAnalyzeSourceMessage(input.task),
    phase: "plan",
    status: "running",
    stepId: "analyze-source",
    taskId: input.task.id,
  });
  await runDeployTaskGatewayWithOutputProgress({
    context: gatewayContext,
    namespace: input.task.namespace,
    runtimeName: runtime.name,
    seenSignatures: outputProgressSignatures,
    task: input.task,
  });
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

  const deployOutput = await readDeployOutput({
    namespace: input.task.namespace,
    runtimeName: runtime.name,
  });
  await recordDeployOutputProgressIfPresent({
    output: deployOutput,
    seenSignatures: outputProgressSignatures,
    taskId: input.task.id,
  });
  let finalDeployOutput = deployOutput;
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
    await runDeployTaskGatewayWithOutputProgress({
      context: gatewayContext,
      namespace: input.task.namespace,
      repairOutput: true,
      runtimeName: runtime.name,
      seenSignatures: outputProgressSignatures,
      task: input.task,
    });
    finalDeployOutput = await readDeployOutput({
      namespace: input.task.namespace,
      runtimeName: runtime.name,
    });
    await recordDeployOutputProgressIfPresent({
      output: finalDeployOutput,
      seenSignatures: outputProgressSignatures,
      taskId: input.task.id,
    });
  }

  if (finalDeployOutput == null) {
    await blockForMissingAiDeploymentOutput(input.task);
    return;
  }

  await applyGeneratedAiDeployOutput({
    encodedKubeconfig: input.encodedKubeconfig,
    githubToken: githubToken ?? undefined,
    kubeconfig: input.kubeconfig,
    output: finalDeployOutput,
    task: input.task,
  });
}

export async function startDeployTaskRunner(
  input: StartDeployTaskRunnerInput
): Promise<void> {
  const task = await getDeployTaskById(input.taskId);
  if (task == null) {
    throw new Error("Deploy task not found.");
  }

  try {
    const kubeconfig = requireKubeconfig(input);
    const target = await resolveDeploymentTaskTarget(task);
    const resolvedTask = (await getDeployTaskById(task.id)) ?? task;
    const submittedInputValues = submittedInputStringValues(
      input.submittedInputValues
    );
    if (
      Object.keys(submittedInputValues).length > 0 &&
      resolvedTask.runner.kind === "ai"
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
            ? ((await getGithubAccessToken(resolvedTask.namespace)) ??
              undefined)
            : undefined,
        kubeconfig,
        outputJson,
        task: resolvedTask,
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
          task: resolvedTask,
        });
        break;
      case "ai":
        await runAiDeploymentTask({
          encodedKubeconfig: input.encodedKubeconfig ?? "",
          kubeconfig,
          task: resolvedTask,
        });
        break;
      default:
        resolvedTask.runner satisfies never;
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureMessage = deployTaskFailureSummary(error);
    const latestTask = (await getDeployTaskById(task.id)) ?? task;
    const recordedFailureEvent = await markDeployTaskFailureTimeline({
      errorMessage: message,
      failureMessage,
      task: latestTask,
    });
    await updateDeployTaskState(task.id, {
      error: message,
      failureDetails: {
        ...deployFailureDetails({
          error,
          phase: latestTask.phase,
          source: "startDeployTaskRunner",
          task: latestTask,
        }),
        failureMessage,
      },
      status: "failed",
    });
    if (!recordedFailureEvent) {
      await recordDeployTaskEvent(task.id, {
        kind: "deployment_task.failed",
        message: failureMessage,
        payload: { error: message },
        phase: latestTask.phase,
      });
    }
    throw error;
  }
}
