import "server-only";

import { createHash } from "node:crypto";
import type { Sandbox as BashToolSandbox } from "bash-tool";
import {
  createDevbox,
  DevboxApiError,
  execDevbox,
  getDevbox,
  listDevboxes,
  refreshDevboxPause,
  resumeDevbox,
} from "./client";
import {
  getDevboxArchiveAfterPauseTime,
  getDevboxDefaultImage,
} from "./config";
import type { DevboxInfo } from "./types";

const DEVBOX_NAME_PREFIX = "sealai-chat";
const DEVBOX_RUNTIME_READY_TIMEOUT_MS = 60_000;
const DEVBOX_RUNTIME_READY_POLL_MS = 2000;
const DEVBOX_SECRET_READY_MAX_RETRIES = 3;
const DEVBOX_SECRET_READY_RETRY_DELAY_MS = 2000;
const DEVBOX_DEFAULT_MAX_DURATION_MINUTES = 300;
const DEVBOX_COMMAND_TIMEOUT_SECONDS = 60;
const DEVBOX_WRITE_TIMEOUT_SECONDS = 60;
const DEVBOX_READ_TIMEOUT_SECONDS = 60;
const DEVBOX_WARMUP_TIMEOUT_SECONDS = 30;

export interface ChatDevboxRuntimeOptions {
  kubeconfig: string;
  namespace: string;
}

export interface ChatDevboxRuntimeSummary {
  devboxName: string;
  skippedExisting: boolean;
}

export type ChatDevboxSandbox = BashToolSandbox & {
  getDevboxName: () => Promise<string>;
  stop: () => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeKubeconfig(kubeconfig: string): string {
  if (!kubeconfig.includes("apiVersion:")) {
    throw new Error("Kubeconfig does not look valid.");
  }
  return kubeconfig;
}

export function hashKubeconfigForDevbox(kubeconfig: string): string {
  return createHash("sha256").update(kubeconfig).digest("hex").slice(0, 32);
}

function hashRuntimeIdentity(kubeconfig: string, namespace: string): string {
  return createHash("sha256")
    .update(`${namespace}|${hashKubeconfigForDevbox(kubeconfig)}`)
    .digest("hex")
    .slice(0, 32);
}

function runtimeName(runtimeHash: string): string {
  return `${DEVBOX_NAME_PREFIX}-${runtimeHash.slice(0, 20)}`;
}

function runtimeUpstreamId(runtimeHash: string): string {
  return `sealai-chat-${runtimeHash}`;
}

function getPauseAt(): string {
  return new Date(
    Date.now() + DEVBOX_DEFAULT_MAX_DURATION_MINUTES * 60 * 1000
  ).toISOString();
}

function isDevboxSecretPendingError(error: unknown): error is DevboxApiError {
  return (
    error instanceof DevboxApiError &&
    error.status >= 500 &&
    error.message.includes("get devbox private key failed") &&
    error.message.includes("not found")
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

  throw new Error("Timed out waiting for Devbox runtime");
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

async function refreshLease(
  authNamespace: string,
  name: string
): Promise<void> {
  await refreshDevboxPause(authNamespace, name, { pauseAt: getPauseAt() });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function readFileCommand(path: string): string {
  return `cat -- ${shellQuote(path)}`;
}

function writeFileCommand(path: string, content: string): string {
  const encoded = Buffer.from(content, "utf8").toString("base64");
  return [
    "set -euo pipefail",
    `mkdir -p -- "$(dirname -- ${shellQuote(path)})"`,
    `base64 -d > ${shellQuote(path)} <<'EOF'`,
    encoded,
    "EOF",
  ].join("\n");
}

async function runDevboxCommand(
  authNamespace: string,
  name: string,
  command: string,
  timeoutSeconds = DEVBOX_COMMAND_TIMEOUT_SECONDS
) {
  const response = await execDevbox(authNamespace, name, {
    command: ["bash", "-lc", command],
    timeoutSeconds,
  });
  return response.data;
}

async function assertDevboxKubectlReady(
  authNamespace: string,
  name: string,
  namespace: string
): Promise<void> {
  const result = await runDevboxCommand(
    authNamespace,
    name,
    [
      "set -euo pipefail",
      "command -v kubectl >/dev/null",
      `kubectl auth can-i get pods -n ${shellQuote(namespace)} >/dev/null`,
    ].join("\n"),
    DEVBOX_WARMUP_TIMEOUT_SECONDS
  );

  if (result.exitCode !== 0) {
    throw new Error(
      [
        "Devbox kubectl readiness check failed.",
        result.stderr.trim() || result.stdout.trim(),
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}

async function ensureChatDevbox(
  options: ChatDevboxRuntimeOptions
): Promise<{ name: string; skippedExisting: boolean }> {
  const kubeconfig = normalizeKubeconfig(options.kubeconfig);
  const authNamespace = options.namespace;
  const runtimeHash = hashRuntimeIdentity(kubeconfig, options.namespace);
  const name = runtimeName(runtimeHash);
  const upstreamID = runtimeUpstreamId(runtimeHash);

  const existing = (await listDevboxes(authNamespace, upstreamID)).data
    .items[0];
  if (existing != null) {
    await ensureRunningDevbox(authNamespace, existing.name);
    await refreshLease(authNamespace, existing.name);
    await assertDevboxKubectlReady(
      authNamespace,
      existing.name,
      options.namespace
    );
    return { name: existing.name, skippedExisting: true };
  }

  await createDevbox(authNamespace, {
    archiveAfterPauseTime: getDevboxArchiveAfterPauseTime(),
    env: {
      SEALAI_ASSISTANT_NAMESPACE: options.namespace,
    },
    image: getDevboxDefaultImage(),
    kubeAccess: {
      enabled: true,
      roleTemplate: "edit",
    },
    labels: [
      { key: "app.kubernetes.io/managed-by", value: "sealai" },
      { key: "app.kubernetes.io/component", value: "assistant-runtime" },
    ],
    name,
    pauseAt: getPauseAt(),
    upstreamID,
  });

  await waitForRunningDevbox(authNamespace, name);
  await assertDevboxKubectlReady(authNamespace, name, options.namespace);
  return { name, skippedExisting: false };
}

export async function bootstrapChatDevboxIfNeeded(
  options: ChatDevboxRuntimeOptions
): Promise<ChatDevboxRuntimeSummary> {
  const result = await ensureChatDevbox(options);
  return {
    devboxName: result.name,
    skippedExisting: result.skippedExisting,
  };
}

export function createChatDevboxSandbox(
  options: ChatDevboxRuntimeOptions
): ChatDevboxSandbox {
  let runtimePromise:
    | Promise<{ name: string; skippedExisting: boolean }>
    | undefined;

  const getRuntime = () => {
    runtimePromise ??= ensureChatDevbox(options);
    return runtimePromise;
  };

  return {
    async executeCommand(command) {
      const { name } = await getRuntime();
      const result = await runDevboxCommand(options.namespace, name, command);
      return {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
      };
    },
    async getDevboxName() {
      const { name } = await getRuntime();
      return name;
    },
    async readFile(path) {
      const { name } = await getRuntime();
      const result = await runDevboxCommand(
        options.namespace,
        name,
        readFileCommand(path),
        DEVBOX_READ_TIMEOUT_SECONDS
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `Devbox file read failed: ${result.stderr || result.stdout}`.trim()
        );
      }
      return result.stdout;
    },
    async stop() {
      await Promise.resolve();
      runtimePromise = undefined;
    },
    async writeFiles(files) {
      const { name } = await getRuntime();
      for (const file of files) {
        if (typeof file.content !== "string") {
          throw new Error("Devbox writeFiles only supports text content.");
        }
        const result = await runDevboxCommand(
          options.namespace,
          name,
          writeFileCommand(file.path, file.content),
          DEVBOX_WRITE_TIMEOUT_SECONDS
        );
        if (result.exitCode !== 0) {
          throw new Error(
            `Devbox file write failed: ${result.stderr || result.stdout}`.trim()
          );
        }
      }
    },
  };
}
