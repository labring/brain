import "server-only";

import { createHash } from "node:crypto";

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
import { getGithubAccessToken } from "@/lib/github-oauth/connection-service";

import { prepareDeployTaskArtifacts } from "./artifacts";
import {
  DEPLOY_GATEWAY_MODEL,
  getCodexGatewayContextFromDevboxInfo,
  runDeployTaskGateway,
} from "./gateway";
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

export interface StartDeployTaskRunnerInput {
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
  repoUrl: string;
  taskId: string;
}): string {
  return createHash("sha256")
    .update(`${input.namespace}|${input.repoUrl}|${input.taskId}`)
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

function installSkillsCommand(): string {
  return [
    "set -euo pipefail",
    `workspace_dir=${shellQuote(DEPLOY_WORKSPACE_DIR)}`,
    'agent_skill_marker="$workspace_dir/.agents/skills/brain-github-deploy/SKILL.md"',
    'codex_skill_marker="$workspace_dir/.codex/skills/brain-github-deploy/SKILL.md"',
    'if [ ! -f "$agent_skill_marker" ] && [ ! -f "$codex_skill_marker" ]; then',
    "if command -v npx >/dev/null 2>&1; then",
    '  cd "$workspace_dir"',
    "  timeout 120 npx --yes skills add https://github.com/Che-Zhu/brain-sandbox-skills -y",
    "else",
    "  printf 'ERROR: npx is required to install brain-github-deploy skill\\n' >&2",
    "  exit 1",
    "fi",
    "fi",
    'if [ ! -f "$agent_skill_marker" ] && [ ! -f "$codex_skill_marker" ]; then',
    "  printf 'ERROR: brain-github-deploy skill not found after install\\n' >&2",
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

  const hash = runtimeHash(input);
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

export async function startDeployTaskRunner(
  input: StartDeployTaskRunnerInput
): Promise<void> {
  const task = await getDeployTaskById(input.taskId);
  if (task == null) {
    throw new Error("Deploy task not found.");
  }

  try {
    await updateDeployTaskState(task.id, {
      phase: "runtime",
      status: "running",
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deploy_task.runner_started",
      message: "Preparing deploy runtime.",
      phase: "runtime",
    });

    const githubToken = await getGithubAccessToken(task.namespace);

    const runtime = await ensureDeployDevbox({
      existingRuntimeName: task.runtimeName,
      githubToken: githubToken ?? undefined,
      namespace: task.namespace,
      repoUrl: task.repoUrl,
      taskId: task.id,
    });

    await updateDeployTaskState(task.id, {
      runtimeName: runtime.name,
      runtimeProvider: "devbox",
      runtimeState: runtime.info.state.phase,
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deploy_task.runtime_ready",
      message: "Deploy runtime is ready.",
      payload: { runtimeName: runtime.name },
      phase: "runtime",
    });

    await updateDeployTaskState(task.id, {
      phase: "workspace",
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deploy_task.workspace_clone_started",
      message: "Cloning repository into deploy workspace.",
      phase: "workspace",
    });
    await execOrThrow({
      command: cloneWorkspaceCommand({
        branch: task.branch,
        githubToken: githubToken ?? undefined,
        repoUrl: task.repoUrl,
      }),
      namespace: task.namespace,
      runtimeName: runtime.name,
      timeoutSeconds: SKILL_INSTALL_TIMEOUT_SECONDS,
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deploy_task.workspace_clone_ready",
      message: "Repository clone is ready.",
      phase: "workspace",
    });
    await execOrThrow({
      command: prepareWorkspaceOutputCommand(),
      namespace: task.namespace,
      runtimeName: runtime.name,
      timeoutSeconds: READ_OUTPUT_TIMEOUT_SECONDS,
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deploy_task.skill_install_started",
      message: "Installing deploy skills into workspace.",
      phase: "workspace",
    });
    await execOrThrow({
      command: installSkillsCommand(),
      namespace: task.namespace,
      runtimeName: runtime.name,
      timeoutSeconds: SKILL_INSTALL_TIMEOUT_SECONDS,
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deploy_task.workspace_ready",
      message: "Repository workspace is ready.",
      phase: "workspace",
    });

    const latestRuntimeInfo = await getDevboxWithSecretRetry(
      task.namespace,
      runtime.name
    );
    const gatewayContext =
      getCodexGatewayContextFromDevboxInfo(latestRuntimeInfo);

    if (gatewayContext == null) {
      await updateDeployTaskState(task.id, {
        phase: "analyze",
        status: "blocked",
      });
      await recordDeployTaskEvent(task.id, {
        kind: "deploy_task.gateway_unavailable",
        message:
          "Workspace is ready, but the Devbox did not expose a Codex gateway URL.",
        phase: "analyze",
      });
      return;
    }

    await runDeployTaskGateway({
      context: gatewayContext,
      task,
    });

    const deployOutput = await readDeployOutput({
      namespace: task.namespace,
      runtimeName: runtime.name,
    });
    let finalDeployOutput = deployOutput;
    if (finalDeployOutput == null) {
      await recordDeployTaskEvent(task.id, {
        kind: "deploy_task.output_repair_started",
        message:
          "Codex gateway completed without deployment output; requesting a repair turn.",
        phase: "generate",
      });
      await runDeployTaskGateway({
        context: gatewayContext,
        repairOutput: true,
        task,
      });
      finalDeployOutput = await readDeployOutput({
        namespace: task.namespace,
        runtimeName: runtime.name,
      });
    }

    if (finalDeployOutput == null) {
      await updateDeployTaskState(task.id, {
        artifactSummary: {
          notes: "Codex gateway completed without deployment output.",
        },
        phase: "ship",
        status: "blocked",
      });
      await recordDeployTaskEvent(task.id, {
        kind: "deploy_task.output_missing",
        message: "Codex gateway completed without deployment output.",
        phase: "ship",
      });
      return;
    }

    const preparedArtifacts = prepareDeployTaskArtifacts({
      output: finalDeployOutput,
      task,
    });
    await updateDeployTaskState(task.id, {
      artifactSummary: {
        outputJson: finalDeployOutput,
        resources: preparedArtifacts.resources,
        resourceYamls: [preparedArtifacts.yaml],
      },
      phase: "apply",
      status: "applying",
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deploy_task.apply_started",
      message: "Applying generated Brain direct resources.",
      payload: { resources: preparedArtifacts.resources },
      phase: "apply",
    });
    const applyOutput = await applyDeployYaml({
      namespace: task.namespace,
      runtimeName: runtime.name,
      yaml: preparedArtifacts.yaml,
    });

    await updateDeployTaskState(task.id, {
      artifactSummary: {
        notes: applyOutput,
        outputJson: finalDeployOutput,
        resources: preparedArtifacts.resources,
        resourceYamls: [preparedArtifacts.yaml],
      },
      phase: "ship",
      status: "completed",
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deploy_task.completed",
      message: "Deploy task completed.",
      payload: {
        applyOutput,
        resources: preparedArtifacts.resources,
      },
      phase: "ship",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateDeployTaskState(task.id, {
      error: message,
      status: "failed",
    });
    await recordDeployTaskEvent(task.id, {
      kind: "deploy_task.failed",
      message,
    });
    throw error;
  }
}
