import "server-only";

import { createHash } from "node:crypto";

import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import { templateDeploymentExtraLabels } from "@/app/api/templates/deploy/labels";
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
import { deployTemplateInstance } from "@/lib/template-provider-core";

import {
  type DeploymentArtifact,
  type DeployTaskPreparedArtifacts,
  prepareBrainManifestArtifact,
  prepareDeployTaskArtifacts,
} from "./artifacts";
import {
  DEPLOY_GATEWAY_MODEL,
  getCodexGatewayContextFromDevboxInfo,
  runDeployTaskGateway,
} from "./gateway";
import type { DeployTaskRow } from "./schema";
import {
  getDeployTaskById,
  recordDeployTaskEvent,
  updateDeployTaskState,
} from "./service";

const DEPLOY_DEVBOX_NAME_PREFIX = "sealai-deploy";
const DEVBOX_RUNTIME_READY_TIMEOUT_MS = 60_000;
const DEVBOX_RUNTIME_READY_POLL_MS = 2000;
const DEVBOX_SECRET_READY_MAX_RETRIES = 3;
const DEVBOX_SECRET_READY_RETRY_DELAY_MS = 2000;
const DEVBOX_SDK_READY_MAX_RETRIES = 30;
const DEVBOX_SDK_READY_RETRY_DELAY_MS = 2000;
const DEVBOX_DEFAULT_MAX_DURATION_MINUTES = 300;
const DEPLOY_WORKSPACE_DIR = "/home/devbox/project";
const DEPLOY_OUTPUT_PATH = `${DEPLOY_WORKSPACE_DIR}/.sealos/deployment-output.json`;
const DEPLOY_AP_YAML_PATH = `${DEPLOY_WORKSPACE_DIR}/.sealos/brain/ap.yaml`;
const SKILL_INSTALL_TIMEOUT_SECONDS = 300;
const READ_OUTPUT_TIMEOUT_SECONDS = 30;
const APPLY_OUTPUT_TIMEOUT_SECONDS = 120;
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

async function applyDeploymentArtifact(input: {
  artifact: DeploymentArtifact;
  kubeconfig: string;
  task: DeployTaskRow;
}): Promise<{
  artifactSummary: Record<string, unknown>;
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
  return (
    error instanceof DevboxApiError &&
    error.status >= 500 &&
    error.message.includes("sdk server") &&
    error.message.includes("is not reachable yet")
  );
}

type ResolvableDeploymentTaskTarget = Pick<
  DeployTaskRow,
  "id" | "namespace" | "projectId" | "projectName" | "target"
>;

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

async function waitForRunningDevbox(
  authNamespace: string,
  name: string
): Promise<DevboxInfo> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < DEVBOX_RUNTIME_READY_TIMEOUT_MS) {
    const info = await getDevboxWithSecretRetry(authNamespace, name);
    if (info.state.phase === "Running") {
      return info;
    }
    await sleep(DEVBOX_RUNTIME_READY_POLL_MS);
  }

  throw new Error("Timed out waiting for deploy Devbox runtime");
}

async function ensureRunningDevbox(
  authNamespace: string,
  name: string
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

  return await waitForRunningDevbox(authNamespace, name);
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
    'mkdir -p "$workspace_dir/.sealos/brain"',
    'rm -f "$workspace_dir/.sealos/deployment-output.json"',
    'rm -f "$workspace_dir/.sealos/brain/ap.yaml"',
    "if id devbox >/dev/null 2>&1; then",
    '  if [ "$(id -u)" = "0" ]; then',
    '    chown -R devbox:devbox "$workspace_dir/.sealos"',
    "  elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then",
    '    sudo chown -R devbox:devbox "$workspace_dir/.sealos"',
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
    'mkdir -p "$workspace_dir/.sealos/brain"',
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
    "  timeout 120 npx --yes skills add https://github.com/zjy365/sealos-skills/tree/sandbox-skill-lite -y",
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

function readDeployOutputCommand(): string {
  return [
    "set -euo pipefail",
    `output_path=${shellQuote(DEPLOY_OUTPUT_PATH)}`,
    `ap_yaml_path=${shellQuote(DEPLOY_AP_YAML_PATH)}`,
    'test -f "$output_path"',
    'test -f "$ap_yaml_path"',
    "OUTPUT_PATH=\"$output_path\" AP_YAML_PATH=\"$ap_yaml_path\" node -e \"const fs=require('fs'); const output=JSON.parse(fs.readFileSync(process.env.OUTPUT_PATH,'utf8')); const apYaml=fs.readFileSync(process.env.AP_YAML_PATH,'utf8'); process.stdout.write(JSON.stringify({deploymentOutput: output, resourceYamls: [apYaml]}));\"",
  ].join("\n");
}

function applyYamlCommand(): string {
  return [
    "set -euo pipefail",
    "tmpfile=$(mktemp)",
    'cleanup() { rm -f "$tmpfile"; }',
    "trap cleanup EXIT",
    'cat > "$tmpfile"',
    'kubectl apply -f "$tmpfile"',
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
      existingRuntimeName
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
    const info = await ensureRunningDevbox(input.namespace, existing.name);
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

  const info = await waitForRunningDevbox(input.namespace, name);
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
  namespace: string;
  runtimeName: string;
}): Promise<Record<string, unknown> | null> {
  const result = (
    await execDevbox(input.namespace, input.runtimeName, {
      command: ["bash", "-lc", readDeployOutputCommand()],
      timeoutSeconds: READ_OUTPUT_TIMEOUT_SECONDS,
    })
  ).data;

  if (result.exitCode !== 0 || result.stdout.trim() === "") {
    return null;
  }

  const parsed = JSON.parse(result.stdout) as unknown;
  return parsed != null && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : null;
}

async function applyDeployYaml(input: {
  namespace: string;
  runtimeName: string;
  yaml: string;
}): Promise<string> {
  const result = (
    await execDevbox(input.namespace, input.runtimeName, {
      command: ["bash", "-lc", applyYamlCommand()],
      stdin: input.yaml,
      timeoutSeconds: APPLY_OUTPUT_TIMEOUT_SECONDS,
    })
  ).data;

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim());
  }
  return result.stdout.trim();
}

async function completeTaskWithArtifact(input: {
  artifact: DeploymentArtifact;
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

  const applied = await applyDeploymentArtifact({
    artifact: input.artifact,
    kubeconfig: input.kubeconfig,
    task: input.task,
  });

  await updateDeployTaskState(input.task.id, {
    artifactSummary: {
      ...applied.artifactSummary,
      notes: applied.notes,
      ...(input.outputJson === undefined
        ? {}
        : { outputJson: input.outputJson }),
    },
    phase: "completed",
    status: "completed",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.completed",
    message: "Deployment task completed.",
    payload: applied.artifactSummary,
    phase: "completed",
  });
}

async function completeGithubAiTaskWithDevboxApply(input: {
  artifact: DeploymentArtifact;
  outputJson: Record<string, unknown>;
  prepared: DeployTaskPreparedArtifacts;
  runtimeName: string;
  task: DeployTaskRow;
}) {
  await updateDeployTaskState(input.task.id, {
    artifactSummary: {
      artifacts: [input.artifact],
      outputJson: input.outputJson,
      resources: input.prepared.resources,
      resourceYamls: [input.prepared.yaml],
    },
    phase: "apply",
    status: "applying",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.apply_started",
    message: "Applying generated Brain direct resources in deploy Devbox.",
    payload: { resources: input.prepared.resources },
    phase: "apply",
  });

  const applyOutput = await applyDeployYaml({
    namespace: input.task.namespace,
    runtimeName: input.runtimeName,
    yaml: input.prepared.yaml,
  });

  await updateDeployTaskState(input.task.id, {
    artifactSummary: {
      artifacts: [input.artifact],
      notes: applyOutput,
      outputJson: input.outputJson,
      resources: input.prepared.resources,
      resourceYamls: [input.prepared.yaml],
    },
    phase: "completed",
    status: "completed",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.completed",
    message: "Deployment task completed.",
    payload: {
      applyOutput,
      resources: input.prepared.resources,
    },
    phase: "completed",
  });
}

async function runDirectDeploymentTask(input: {
  kubeconfig: string;
  projectName: string;
  task: DeployTaskRow;
}) {
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

    await completeTaskWithArtifact({
      artifact,
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

async function runAiDeploymentTask(input: {
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
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.prepare_started",
    message: "Preparing deploy runtime.",
    phase: "prepare",
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

  const latestRuntimeInfo = await getDevboxWithSecretRetry(
    input.task.namespace,
    runtime.name
  );
  const gatewayContext =
    getCodexGatewayContextFromDevboxInfo(latestRuntimeInfo);

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
    return;
  }

  await runDeployTaskGateway({
    context: gatewayContext,
    task: input.task,
  });

  const deployOutput = await readDeployOutput({
    namespace: input.task.namespace,
    runtimeName: runtime.name,
  });
  let finalDeployOutput = deployOutput;
  if (finalDeployOutput == null) {
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.output_repair_started",
      message:
        "Codex gateway completed without deployment output; requesting a repair turn.",
      phase: "generate-artifacts",
    });
    await runDeployTaskGateway({
      context: gatewayContext,
      repairOutput: true,
      task: input.task,
    });
    finalDeployOutput = await readDeployOutput({
      namespace: input.task.namespace,
      runtimeName: runtime.name,
    });
  }

  if (finalDeployOutput == null) {
    await updateDeployTaskState(input.task.id, {
      artifactSummary: {
        notes: "Codex gateway completed without deployment output.",
      },
      phase: "generate-artifacts",
      status: "blocked",
    });
    await recordDeployTaskEvent(input.task.id, {
      kind: "deployment_task.output_missing",
      message: "Codex gateway completed without deployment output.",
      phase: "generate-artifacts",
    });
    return;
  }

  const prepared = prepareDeployTaskArtifacts({
    output: finalDeployOutput,
    task: input.task,
  });
  const artifact: DeploymentArtifact = {
    kind: "brain-manifest",
    yaml: prepared.yaml,
  };
  await updateDeployTaskState(input.task.id, {
    artifactSummary: {
      artifacts: [artifact],
      outputJson: finalDeployOutput,
      resources: prepared.resources,
      resourceYamls: [prepared.yaml],
    },
    phase: "generate-artifacts",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deployment_task.artifacts_generated",
    message: "Generated deployment artifacts.",
    payload: { resources: prepared.resources },
    phase: "generate-artifacts",
  });

  if (input.task.source.kind === "github") {
    await completeGithubAiTaskWithDevboxApply({
      artifact,
      outputJson: finalDeployOutput,
      prepared,
      runtimeName: runtime.name,
      task: input.task,
    });
    return;
  }

  await completeTaskWithArtifact({
    artifact,
    kubeconfig: input.kubeconfig,
    outputJson: finalDeployOutput,
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
    await updateDeployTaskState(task.id, {
      error: message,
      status: "failed",
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deployment_task.failed",
      message,
    });
    throw error;
  }
}
