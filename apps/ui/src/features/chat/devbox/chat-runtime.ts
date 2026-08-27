import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import type { Sandbox as BashToolSandbox } from "bash-tool";
import {
  type ChatSkillMeta,
  discoverChatDevboxSkills,
} from "@/features/chat/tool/devbox-skills";
import {
  buildSealosSkillsInstallCommand,
  getSealosSkillsSourceFromEnv,
  SEALOS_SKILLS_CLI_VERSION,
} from "@/features/sealos-skills/install";
import {
  createDevbox,
  DevboxApiError,
  execDevbox,
  getDevbox,
  listDevboxes,
  refreshDevboxPause,
  resumeDevbox,
} from "@/lib/devbox/client";
import { getDevboxDefaultImage } from "@/lib/devbox/config";
import type { DevboxInfo } from "@/lib/devbox/types";
import { recordChatDevboxActivity } from "./lifecycle-registration";

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
const DEVBOX_SKILL_INSTALL_TIMEOUT_SECONDS = 180;
const chatDevboxSkillSnapshots = new Map<string, ChatSkillMeta[]>();
const chatDevboxSkillWarmups = new Map<string, Promise<ChatSkillMeta[]>>();

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
  runWithAbortSignal: <T>(
    signal: AbortSignal | undefined,
    operation: () => Promise<T>
  ) => Promise<T>;
  stop: () => Promise<void>;
};

export function getChatDevboxSkillsSnapshot(
  options: ChatDevboxRuntimeOptions
): ChatSkillMeta[] {
  const snapshot = chatDevboxSkillSnapshots.get(
    chatDevboxSkillCacheKey(options)
  );
  return snapshot?.map((skill) => ({ ...skill })) ?? [];
}

export function warmChatDevboxSkills(
  options: ChatDevboxRuntimeOptions
): Promise<ChatSkillMeta[]> {
  const cacheKey = chatDevboxSkillCacheKey(options);
  const existing = chatDevboxSkillWarmups.get(cacheKey);
  if (existing != null) {
    return existing;
  }

  const sandbox = createChatDevboxSandbox(options);
  const warmup = discoverChatDevboxSkills(sandbox)
    .then((skills) => {
      chatDevboxSkillSnapshots.set(cacheKey, skills);
      return skills.map((skill) => ({ ...skill }));
    })
    .finally(async () => {
      chatDevboxSkillWarmups.delete(cacheKey);
      await sandbox.stop();
    });
  chatDevboxSkillWarmups.set(cacheKey, warmup);
  return warmup;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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

function chatDevboxSkillCacheKey(options: ChatDevboxRuntimeOptions): string {
  const runtimeHash = hashRuntimeIdentity(
    normalizeKubeconfig(options.kubeconfig),
    options.namespace
  );
  const skillSource = getSealosSkillsSourceFromEnv(process.env);
  return `${runtimeHash}|${skillSource}|${SEALOS_SKILLS_CLI_VERSION}`;
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
  name: string,
  signal?: AbortSignal
): Promise<DevboxInfo> {
  let attempt = 0;

  while (true) {
    try {
      signal?.throwIfAborted();
      return (await getDevbox(authNamespace, name, signal)).data;
    } catch (error) {
      if (
        !isDevboxSecretPendingError(error) ||
        attempt >= DEVBOX_SECRET_READY_MAX_RETRIES
      ) {
        throw error;
      }
      attempt += 1;
      await sleep(DEVBOX_SECRET_READY_RETRY_DELAY_MS, signal);
    }
  }
}

async function waitForRunningDevbox(
  authNamespace: string,
  name: string,
  signal?: AbortSignal
): Promise<DevboxInfo> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < DEVBOX_RUNTIME_READY_TIMEOUT_MS) {
    signal?.throwIfAborted();
    const info = await getDevboxWithSecretRetry(authNamespace, name, signal);
    if (info.state.phase === "Running") {
      return info;
    }
    await sleep(DEVBOX_RUNTIME_READY_POLL_MS, signal);
  }

  throw new Error("Timed out waiting for Devbox runtime");
}

async function ensureRunningDevbox(
  authNamespace: string,
  name: string,
  signal?: AbortSignal
): Promise<DevboxInfo> {
  const info = await getDevboxWithSecretRetry(authNamespace, name, signal);
  if (info.state.phase === "Running") {
    return info;
  }

  try {
    signal?.throwIfAborted();
    await resumeDevbox(authNamespace, name, signal);
  } catch (error) {
    if (!(error instanceof DevboxApiError && error.status === 409)) {
      throw error;
    }
  }

  return await waitForRunningDevbox(authNamespace, name, signal);
}

async function refreshLease(
  authNamespace: string,
  name: string,
  pauseAt: string,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  await refreshDevboxPause(authNamespace, name, { pauseAt }, signal);
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
  timeoutSeconds = DEVBOX_COMMAND_TIMEOUT_SECONDS,
  signal?: AbortSignal
) {
  signal?.throwIfAborted();
  const response = await execDevbox(
    authNamespace,
    name,
    {
      command: ["bash", "-lc", command],
      timeoutSeconds,
    },
    signal
  );
  return response.data;
}

async function assertDevboxKubectlReady(
  authNamespace: string,
  name: string,
  namespace: string,
  signal?: AbortSignal
): Promise<void> {
  const result = await runDevboxCommand(
    authNamespace,
    name,
    [
      "set -euo pipefail",
      "command -v kubectl >/dev/null",
      `kubectl auth can-i get pods -n ${shellQuote(namespace)} >/dev/null`,
    ].join("\n"),
    DEVBOX_WARMUP_TIMEOUT_SECONDS,
    signal
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

async function installChatSkills(
  authNamespace: string,
  name: string,
  signal?: AbortSignal
): Promise<void> {
  const result = await runDevboxCommand(
    authNamespace,
    name,
    buildSealosSkillsInstallCommand({
      skillSource: getSealosSkillsSourceFromEnv(process.env),
      timeoutSeconds: DEVBOX_SKILL_INSTALL_TIMEOUT_SECONDS,
    }),
    DEVBOX_SKILL_INSTALL_TIMEOUT_SECONDS,
    signal
  );

  if (result.exitCode !== 0) {
    throw new Error(
      [
        "Chat Devbox Sealos skills installation failed.",
        result.stderr.trim() || result.stdout.trim(),
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
}

async function ensureChatDevbox(
  options: ChatDevboxRuntimeOptions,
  signal?: AbortSignal
): Promise<{ name: string; skippedExisting: boolean }> {
  signal?.throwIfAborted();
  const kubeconfig = normalizeKubeconfig(options.kubeconfig);
  const authNamespace = options.namespace;
  const runtimeHash = hashRuntimeIdentity(kubeconfig, options.namespace);
  const name = runtimeName(runtimeHash);
  const upstreamID = runtimeUpstreamId(runtimeHash);
  const pauseAt = getPauseAt();

  await recordChatDevboxActivity(
    {
      namespace: authNamespace,
      pauseDueAt: new Date(pauseAt),
      runtimeName: name,
      upstreamId: upstreamID,
    },
    signal
  );

  const existing = (await listDevboxes(authNamespace, upstreamID, signal)).data
    .items[0];
  if (existing != null) {
    await ensureRunningDevbox(authNamespace, existing.name, signal);
    await refreshLease(authNamespace, existing.name, pauseAt, signal);
    await assertDevboxKubectlReady(
      authNamespace,
      existing.name,
      options.namespace,
      signal
    );
    await installChatSkills(authNamespace, existing.name, signal);
    return { name: existing.name, skippedExisting: true };
  }

  signal?.throwIfAborted();
  await createDevbox(
    authNamespace,
    {
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
      pauseAt,
      upstreamID,
    },
    signal
  );

  await waitForRunningDevbox(authNamespace, name, signal);
  await assertDevboxKubectlReady(
    authNamespace,
    name,
    options.namespace,
    signal
  );
  await installChatSkills(authNamespace, name, signal);
  return { name, skippedExisting: false };
}

export async function bootstrapChatDevboxIfNeeded(
  options: ChatDevboxRuntimeOptions,
  signal?: AbortSignal
): Promise<ChatDevboxRuntimeSummary> {
  const result = await ensureChatDevbox(options, signal);
  return {
    devboxName: result.name,
    skippedExisting: result.skippedExisting,
  };
}

export function createChatDevboxSandbox(
  options: ChatDevboxRuntimeOptions
): ChatDevboxSandbox {
  const abortSignalStorage = new AsyncLocalStorage<AbortSignal | undefined>();
  let runtimePromise:
    | Promise<{ name: string; skippedExisting: boolean }>
    | undefined;

  const getRuntime = async (signal?: AbortSignal) => {
    if (runtimePromise === undefined) {
      runtimePromise = ensureChatDevbox(options, signal);
    }
    const pendingRuntime = runtimePromise;
    try {
      return await pendingRuntime;
    } catch (error) {
      if (runtimePromise === pendingRuntime) {
        runtimePromise = undefined;
      }
      throw error;
    }
  };

  const getInvocationSignal = () => abortSignalStorage.getStore();

  return {
    async executeCommand(command) {
      const signal = getInvocationSignal();
      signal?.throwIfAborted();
      const { name } = await getRuntime(signal);
      const result = await runDevboxCommand(
        options.namespace,
        name,
        command,
        DEVBOX_COMMAND_TIMEOUT_SECONDS,
        signal
      );
      return {
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
      };
    },
    async getDevboxName() {
      const signal = getInvocationSignal();
      signal?.throwIfAborted();
      const { name } = await getRuntime(signal);
      return name;
    },
    async readFile(path) {
      const signal = getInvocationSignal();
      signal?.throwIfAborted();
      const { name } = await getRuntime(signal);
      const result = await runDevboxCommand(
        options.namespace,
        name,
        readFileCommand(path),
        DEVBOX_READ_TIMEOUT_SECONDS,
        signal
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `Devbox file read failed: ${result.stderr || result.stdout}`.trim()
        );
      }
      return result.stdout;
    },
    async runWithAbortSignal(signal, operation) {
      return await abortSignalStorage.run(signal, operation);
    },
    async stop() {
      await Promise.resolve();
      runtimePromise = undefined;
    },
    async writeFiles(files) {
      const signal = getInvocationSignal();
      signal?.throwIfAborted();
      const { name } = await getRuntime(signal);
      for (const file of files) {
        signal?.throwIfAborted();
        if (typeof file.content !== "string") {
          throw new Error("Devbox writeFiles only supports text content.");
        }
        const result = await runDevboxCommand(
          options.namespace,
          name,
          writeFileCommand(file.path, file.content),
          DEVBOX_WRITE_TIMEOUT_SECONDS,
          signal
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
