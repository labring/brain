import "server-only";

import { getGithubOAuthTokenForOwner } from "@/features/deploy/github/connection-service";
import { CURRENT_GITHUB_OWNER_IDENTITY_VERSION } from "@/features/deploy/github/owner-identity";
import { DevboxApiError, execDevbox } from "@/lib/devbox/client";
import { type AssistantPgDatabase, getAssistantDb } from "../persistence/db";
import {
  type ChatDevboxRuntimeRecord,
  listChatDevboxRuntimesForActor,
} from "./lifecycle";

/** The only runtime file that contains a user's GitHub credential. */
export const CHAT_GITHUB_PROFILE_PATH = "/etc/profile.d/sealai-github.sh";

export const CHAT_GITHUB_STATUS_ENV = "SEALAI_GITHUB_STATUS";

export type ChatGithubCredentialStatus = "connected" | "not-connected";

export interface ChatGithubCredentialSyncResult {
  status: ChatGithubCredentialStatus;
  token: string | null;
}

export interface ChatDevboxCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type ChatDevboxCommandRunner = (
  command: string,
  timeoutSeconds?: number,
  signal?: AbortSignal
) => Promise<ChatDevboxCommandResult>;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Login shells source this file before every command. Keep the token in one
 * atomically replaced file and let `gh` validate/configure git on shell start.
 */
export function buildChatGithubProfile(token: string | null): string {
  if (token == null || token.trim() === "") {
    return [
      "unset GH_TOKEN",
      "unset GITHUB_TOKEN",
      `export ${CHAT_GITHUB_STATUS_ENV}=not-connected`,
    ].join("\n");
  }

  return [
    "unset GITHUB_TOKEN",
    `export GH_TOKEN=${shellQuote(token)}`,
    `export ${CHAT_GITHUB_STATUS_ENV}=connected`,
    "if ! command -v gh >/dev/null 2>&1; then",
    `  export ${CHAT_GITHUB_STATUS_ENV}=cli-unavailable`,
    "elif ! gh auth setup-git >/dev/null 2>&1; then",
    `  export ${CHAT_GITHUB_STATUS_ENV}=credentials-rejected`,
    "fi",
  ].join("\n");
}

/** Prefix user-visible commands with a stable, structured diagnostic. */
export function wrapChatGithubCommand(command: string): string {
  return [
    `case "\${${CHAT_GITHUB_STATUS_ENV}:-not-connected}" in`,
    "  not-connected) printf '%s\n' '[github_not_connected] Connect GitHub in Sealos Brain before using private repositories, issues, or pull requests.' >&2 ;;",
    "  cli-unavailable) printf '%s\n' '[github_cli_unavailable] The Chat Devbox image does not provide the gh CLI.' >&2 ;;",
    "  credentials-rejected) printf '%s\n' '[github_credentials_rejected] GitHub rejected the connected credential; reconnect GitHub and try again.' >&2 ;;",
    "esac",
    command,
  ].join("\n");
}

/** Replace exact and recognizable GitHub token forms in tool output. */
export function redactChatGithubToken(
  output: string,
  token: string | null
): string {
  let redacted = output;
  if (token != null && token !== "") {
    redacted = redacted.split(token).join("[REDACTED_GITHUB_TOKEN]");
  }
  return redacted.replace(
    /\b(?:gho|ghp|ghs|ghu|github_pat)_[A-Za-z0-9_-]+\b/g,
    "[REDACTED_GITHUB_TOKEN]"
  );
}

export async function syncChatGithubCredentials(input: {
  namespace: string;
  workspaceUserUid: string;
  writeProfile: (content: string, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
}): Promise<ChatGithubCredentialSyncResult> {
  const workspaceUserUid = input.workspaceUserUid.trim();
  if (workspaceUserUid === "") {
    return { status: "not-connected", token: null };
  }
  const token = await getGithubOAuthTokenForOwner({
    namespace: input.namespace,
    ownerIdentityVersion: CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
    userUid: workspaceUserUid,
  });
  input.signal?.throwIfAborted();
  await input.writeProfile(buildChatGithubProfile(token), input.signal);

  // The token lookup and runtime write are intentionally separate operations.
  // A disconnect can fence the OAuth row between them, so verify the active
  // row after the write and immediately clear/rewrite the profile when the
  // observed credential changed. This closes the window in which a stale sync
  // could reintroduce a revoked token after disconnect cleanup.
  const activeToken = await getGithubOAuthTokenForOwner({
    namespace: input.namespace,
    ownerIdentityVersion: CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
    userUid: workspaceUserUid,
  });
  input.signal?.throwIfAborted();
  if (activeToken !== token) {
    await input.writeProfile(buildChatGithubProfile(activeToken), input.signal);
    return {
      status: activeToken == null ? "not-connected" : "connected",
      token: activeToken,
    };
  }
  return {
    status: token == null ? "not-connected" : "connected",
    token,
  };
}

function isMissingDevbox(error: unknown): boolean {
  return error instanceof DevboxApiError && error.status === 404;
}

const CLEAR_COMMAND = [
  "set -euo pipefail",
  `rm -f -- ${shellQuote(CHAT_GITHUB_PROFILE_PATH)}`,
  "unset GH_TOKEN GITHUB_TOKEN SEALAI_GITHUB_STATUS",
].join("\n");

async function clearRuntimeCredential(
  runtime: ChatDevboxRuntimeRecord,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  try {
    const response = await execDevbox(
      runtime.namespace,
      runtime.runtimeName,
      {
        command: ["bash", "-lc", CLEAR_COMMAND],
        timeoutSeconds: 30,
      },
      signal
    );
    if (response.data.exitCode !== 0) {
      throw new Error(
        `GitHub credential cleanup failed for ${runtime.runtimeName}: ${response.data.stderr || response.data.stdout}`.trim()
      );
    }
  } catch (error) {
    if (isMissingDevbox(error)) {
      return;
    }
    throw error;
  }
}

/**
 * Disconnect cleanup is bounded and retryable. A missing runtime is already
 * clean; any other failure is surfaced so the HTTP caller can retry cleanup.
 */
export async function clearChatGithubCredentialsForActor(input: {
  namespace: string;
  workspaceUserUid: string;
  db?: AssistantPgDatabase;
  signal?: AbortSignal;
}): Promise<{ attempted: number }> {
  const runtimes = await listChatDevboxRuntimesForActor(
    input.workspaceUserUid,
    input.db ?? getAssistantDb(),
    input.namespace
  );
  let attempted = 0;
  for (let offset = 0; offset < runtimes.length; offset += 4) {
    input.signal?.throwIfAborted();
    const wave = runtimes.slice(offset, offset + 4);
    await Promise.all(
      wave.map((runtime) => clearRuntimeCredential(runtime, input.signal))
    );
    attempted += wave.length;
  }
  return { attempted };
}
