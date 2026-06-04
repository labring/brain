import "server-only";

import type { DeployTaskRow } from "@/lib/chat-persistence/schema";
import type { DevboxInfo } from "@/lib/devbox/types";

import {
  appendDeployTaskMessage,
  recordDeployTaskEvent,
  updateDeployTaskState,
} from "./service";

const CODEX_GATEWAY_STARTUP_TIMEOUT_MS = 60_000;
const CODEX_GATEWAY_STARTUP_RETRY_MS = 1000;
const CODEX_GATEWAY_REQUEST_TIMEOUT_MS = 60_000;
const CODEX_GATEWAY_TURN_TIMEOUT_MS = 15 * 60 * 1000;
const CODEX_GATEWAY_TURN_POLL_MS = 2500;
export const DEPLOY_GATEWAY_MODEL = "gpt-5.5";
const TRAILING_SLASHES_REGEX = /\/+$/;
const LEADING_SLASHES_REGEX = /^\/+/;

interface CodexGatewayHealth {
  ok: boolean;
}

interface CodexGatewayReady {
  ok: boolean;
}

interface CodexGatewayTranscriptEntry {
  createdAt: number;
  id: string;
  role: string;
  source: string;
  status: string;
  text: string;
}

interface CodexGatewayState {
  activeTurn: boolean;
  currentTurnId?: string | null;
  cwd: string;
  lastTurnStatus?: string | null;
  ready: boolean;
  recentEvents: unknown[];
  selectedModel?: string | null;
  startedAt?: string | null;
  threadId?: string | null;
  transcript: CodexGatewayTranscriptEntry[];
}

interface CodexGatewaySessionResponse {
  ok: boolean;
  sessionId: string;
  state: CodexGatewayState;
}

interface GatewayContext {
  authToken: string | null;
  url: string;
}

export class CodexGatewayApiError extends Error {
  body?: unknown;
  status: number;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "CodexGatewayApiError";
    this.status = status;
    this.body = body;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function objectStringValue(
  record: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getCodexGatewayContextFromDevboxInfo(
  info?: DevboxInfo | null
): GatewayContext | null {
  const gateway = info?.gateway as Record<string, unknown> | null | undefined;
  const url =
    objectStringValue(gateway, "url") ??
    objectStringValue(gateway, "route") ??
    objectStringValue(gateway, "externalURL") ??
    objectStringValue(gateway, "appURL") ??
    objectStringValue(gateway, "accessURL");

  if (url == null) {
    return null;
  }

  return {
    authToken:
      objectStringValue(gateway, "accessToken") ??
      objectStringValue(gateway, "authToken") ??
      objectStringValue(gateway, "bearerToken") ??
      objectStringValue(gateway, "token") ??
      objectStringValue(gateway, "jwt"),
    url,
  };
}

export function codexGatewayContextFromStoredTask(input: {
  gatewayUrl: string | null;
}): GatewayContext | null {
  const gatewayUrl = input.gatewayUrl?.trim();
  return gatewayUrl ? { authToken: null, url: gatewayUrl } : null;
}

export function getCodexGatewayEventStreamUrl(
  context: GatewayContext,
  sessionId: string
): string {
  const url = new URL(
    buildUrl(
      context.url,
      `/api/sessions/${encodeURIComponent(sessionId)}/events`
    )
  );
  if (context.authToken != null) {
    url.searchParams.set("access_token", context.authToken);
  }
  return url.toString();
}

function buildUrl(baseUrl: string, path: string): string {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(TRAILING_SLASHES_REGEX, "");
  const relativePath = path.replace(LEADING_SLASHES_REGEX, "");
  url.pathname = `${basePath}/${relativePath}`;
  return url.toString();
}

async function parseGatewayResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return await response.json();
  }
  const text = await response.text();
  return text || null;
}

async function gatewayRequest<T>(
  context: GatewayContext,
  path: string,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body != null) {
    headers.set("content-type", "application/json");
  }
  if (context.authToken != null) {
    headers.set("authorization", `Bearer ${context.authToken}`);
  }

  const response = await fetch(buildUrl(context.url, path), {
    ...init,
    cache: "no-store",
    headers,
    signal:
      init?.signal ?? AbortSignal.timeout(CODEX_GATEWAY_REQUEST_TIMEOUT_MS),
  });
  const body = await parseGatewayResponse(response);

  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body != null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `Codex gateway request failed with status ${response.status}`;
    throw new CodexGatewayApiError(message, response.status, body);
  }

  return body as T;
}

async function waitForCodexGatewayReady(
  context: GatewayContext
): Promise<void> {
  const deadline = Date.now() + CODEX_GATEWAY_STARTUP_TIMEOUT_MS;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const health = await gatewayRequest<CodexGatewayHealth>(
        context,
        "/healthz"
      );
      const ready = await gatewayRequest<CodexGatewayReady>(context, "/readyz");
      if (health.ok && ready.ok) {
        return;
      }
      lastError = new Error("Codex gateway is not ready.");
    } catch (error) {
      lastError = error;
    }
    await sleep(CODEX_GATEWAY_STARTUP_RETRY_MS);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Codex gateway startup check timed out.");
}

async function createGatewaySession(
  context: GatewayContext
): Promise<CodexGatewaySessionResponse> {
  return await gatewayRequest<CodexGatewaySessionResponse>(
    context,
    "/api/sessions",
    {
      body: JSON.stringify({ model: DEPLOY_GATEWAY_MODEL }),
      method: "POST",
    }
  );
}

async function sendGatewayTurn(
  context: GatewayContext,
  sessionId: string,
  prompt: string
): Promise<CodexGatewaySessionResponse> {
  return await gatewayRequest<CodexGatewaySessionResponse>(
    context,
    `/api/sessions/${encodeURIComponent(sessionId)}/turn`,
    {
      body: JSON.stringify({ prompt }),
      method: "POST",
    }
  );
}

async function getGatewaySessionState(
  context: GatewayContext,
  sessionId: string
): Promise<CodexGatewaySessionResponse> {
  return await gatewayRequest<CodexGatewaySessionResponse>(
    context,
    `/api/sessions/${encodeURIComponent(sessionId)}/state`
  );
}

function assistantTextFromState(state: CodexGatewayState): string | null {
  const text = state.transcript
    .filter((entry) => entry.role === "assistant")
    .map((entry) => entry.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  return text || null;
}

async function projectGatewayState(input: {
  sessionId: string;
  state: CodexGatewayState;
  taskId: string;
}): Promise<void> {
  await updateDeployTaskState(input.taskId, {
    gatewayThreadId: input.state.threadId ?? null,
    gatewayTurnId: input.state.currentTurnId ?? null,
    status: input.state.activeTurn ? "running" : "blocked",
  });

  const assistantText = assistantTextFromState(input.state);
  if (assistantText != null) {
    await appendDeployTaskMessage({
      id: `gateway-${input.sessionId}-latest`,
      parts: [{ text: assistantText, type: "text" }],
      role: "assistant",
      taskId: input.taskId,
    });
  }
}

async function waitForGatewayTurnCompletion(input: {
  context: GatewayContext;
  sessionId: string;
  taskId: string;
}): Promise<CodexGatewayState> {
  const deadline = Date.now() + CODEX_GATEWAY_TURN_TIMEOUT_MS;
  let latestState: CodexGatewayState | null = null;

  while (Date.now() < deadline) {
    const sessionState = await getGatewaySessionState(
      input.context,
      input.sessionId
    );
    latestState = sessionState.state;
    await projectGatewayState({
      sessionId: input.sessionId,
      state: sessionState.state,
      taskId: input.taskId,
    });

    if (!sessionState.state.activeTurn) {
      return sessionState.state;
    }

    await sleep(CODEX_GATEWAY_TURN_POLL_MS);
  }

  await recordDeployTaskEvent(input.taskId, {
    kind: "deploy_task.gateway_timeout",
    message: "Codex gateway response timed out.",
    phase: "analyze",
  });

  if (latestState != null) {
    return latestState;
  }
  throw new Error("Codex gateway response timed out.");
}

async function persistGatewayStateEvent(input: {
  payload: Record<string, unknown> | null;
  sessionId: string;
  taskId: string;
}): Promise<void> {
  const state = (input.payload ?? {}) as Partial<CodexGatewayState> &
    Record<string, unknown>;
  await updateDeployTaskState(input.taskId, {
    gatewayThreadId: state.threadId ?? null,
    gatewayTurnId: state.currentTurnId ?? null,
    status: state.activeTurn === false ? "blocked" : "running",
  });
  await recordDeployTaskEvent(input.taskId, {
    kind: "deploy_task.gateway_state",
    message: "Codex gateway state updated.",
    payload: input.payload ?? {},
    phase: "analyze",
  });

  if (!Array.isArray(state.transcript)) {
    return;
  }

  const assistantText = assistantTextFromState({
    activeTurn: Boolean(state.activeTurn),
    currentTurnId: state.currentTurnId ?? null,
    cwd: typeof state.cwd === "string" ? state.cwd : "",
    lastTurnStatus: state.lastTurnStatus ?? null,
    ready: Boolean(state.ready),
    recentEvents: Array.isArray(state.recentEvents) ? state.recentEvents : [],
    selectedModel: state.selectedModel ?? null,
    startedAt: state.startedAt ?? null,
    threadId: state.threadId ?? null,
    transcript: state.transcript,
  });
  if (assistantText != null) {
    await appendDeployTaskMessage({
      id: `gateway-${input.sessionId}-latest`,
      parts: [{ text: assistantText, type: "text" }],
      role: "assistant",
      taskId: input.taskId,
    });
  }
}

export async function persistDeployGatewayEvent(input: {
  eventName: string;
  payload: Record<string, unknown> | null;
  sessionId: string;
  taskId: string;
}): Promise<void> {
  const common = {
    payload: input.payload ?? {},
    phase: "analyze" as const,
  };

  if (input.eventName === "session") {
    await recordDeployTaskEvent(input.taskId, {
      ...common,
      kind: "deploy_task.gateway_session_event",
      message: "Codex gateway session event received.",
    });
    return;
  }

  if (input.eventName === "state") {
    await persistGatewayStateEvent(input);
    return;
  }

  await recordDeployTaskEvent(input.taskId, {
    ...common,
    kind: `deploy_task.gateway_${input.eventName.replace(/[^a-z0-9]+/gi, "_")}`,
    message: "Codex gateway event received.",
  });
}

function buildGatewayPrompt(task: DeployTaskRow): string {
  return [
    "You are running inside a SealAI deployment Devbox.",
    "Work in /home/devbox/project, which already contains the cloned GitHub repository.",
    "",
    "Run the brain-github-deploy skill to completion:",
    "/brain-github-deploy using the already-cloned repository in /home/devbox/project.",
    "",
    "Proceed automatically through all phases without stopping to ask for confirmation or input.",
    "Do not replace the skill workflow with your own ad-hoc deployment format.",
    "",
    "When complete, ensure these output files exist:",
    "- /home/devbox/project/.sealos/deployment-output.json",
    "- /home/devbox/project/.sealos/brain/ap.yaml",
    "",
    "The Brain AP YAML must use apiVersion brain.io/direct and kind AP.",
    "For AP specs, use spec.input.image and spec.input.network; do not use retired top-level spec.image or spec.ports.",
    'If anything fails, write /home/devbox/project/.sealos/deployment-output.json with status "failed" and include an actionable error message in the error field.',
    "Before ending, verify with: test -s /home/devbox/project/.sealos/deployment-output.json && test -s /home/devbox/project/.sealos/brain/ap.yaml",
    "",
    `Repository: ${task.repoFullName}`,
    `Branch: ${task.branch ?? "default"}`,
    `Namespace: ${task.namespace}`,
    task.projectName ? `Project: ${task.projectName}` : null,
    task.prompt ? `User request: ${task.prompt}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildGatewayRepairPrompt(task: DeployTaskRow): string {
  return [
    "The previous turn completed, but required Sealos deployment output files were missing or empty.",
    "Fix this now by running /brain-github-deploy to completion in /home/devbox/project.",
    "Do not ask a question and do not stop after a prose answer.",
    "Required files:",
    "- /home/devbox/project/.sealos/deployment-output.json",
    "- /home/devbox/project/.sealos/brain/ap.yaml",
    "The AP YAML must use spec.input.image and spec.input.network, not top-level spec.image/spec.ports.",
    'If deployment cannot succeed, write deployment-output.json with status "failed" and an actionable error field.',
    task.projectName
      ? `Use this project id in generated AP/DB specs as spec.projectId: ${task.projectName}`
      : null,
    task.prompt ? `User request: ${task.prompt}` : null,
    "Before ending, verify with: test -s /home/devbox/project/.sealos/deployment-output.json && test -s /home/devbox/project/.sealos/brain/ap.yaml",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function runDeployTaskGateway(input: {
  context: GatewayContext;
  repairOutput?: boolean;
  task: DeployTaskRow;
}): Promise<void> {
  await updateDeployTaskState(input.task.id, {
    gatewayUrl: input.context.url,
    phase: "analyze",
    status: "running",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_waiting",
    message: "Waiting for Codex gateway.",
    phase: "analyze",
  });

  await waitForCodexGatewayReady(input.context);

  const session = await createGatewaySession(input.context);
  await updateDeployTaskState(input.task.id, {
    gatewaySessionId: session.sessionId,
    gatewayThreadId: session.state.threadId ?? null,
    gatewayTurnId: session.state.currentTurnId ?? null,
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_session_created",
    message: "Codex gateway session is ready.",
    payload: {
      sessionId: session.sessionId,
      threadId: session.state.threadId ?? null,
    },
    phase: "analyze",
  });

  const turn = await sendGatewayTurn(
    input.context,
    session.sessionId,
    input.repairOutput
      ? buildGatewayRepairPrompt(input.task)
      : buildGatewayPrompt(input.task)
  );
  await updateDeployTaskState(input.task.id, {
    gatewayThreadId: turn.state.threadId ?? null,
    gatewayTurnId: turn.state.currentTurnId ?? null,
    status: turn.state.activeTurn ? "running" : "blocked",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_turn_sent",
    message: "Codex gateway turn started.",
    payload: {
      activeTurn: turn.state.activeTurn,
      lastTurnStatus: turn.state.lastTurnStatus ?? null,
      threadId: turn.state.threadId ?? null,
      turnId: turn.state.currentTurnId ?? null,
    },
    phase: "analyze",
  });

  const assistantText = assistantTextFromState(turn.state);
  if (assistantText != null) {
    await appendDeployTaskMessage({
      parts: [{ text: assistantText, type: "text" }],
      role: "assistant",
      taskId: input.task.id,
    });
  }

  const finalState = await waitForGatewayTurnCompletion({
    context: input.context,
    sessionId: session.sessionId,
    taskId: input.task.id,
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_turn_completed",
    message: "Codex gateway turn completed.",
    payload: {
      lastTurnStatus: finalState.lastTurnStatus ?? null,
      turnId: finalState.currentTurnId ?? null,
    },
    phase: "generate",
  });
}
