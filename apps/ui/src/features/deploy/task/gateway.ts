import "server-only";

import type { DevboxInfo } from "@/lib/devbox/types";
import { buildGatewayPrompt, buildGatewayRepairPrompt } from "./gateway-prompt";
import {
  recordDeployTaskEvent,
  throwIfDeployTaskAborted,
  updateDeployTaskState,
} from "./runner-writes";
import type { DeployTaskFailureDetails, DeployTaskRow } from "./schema";

const CODEX_GATEWAY_STARTUP_TIMEOUT_MS = 60_000;
const CODEX_GATEWAY_STARTUP_RETRY_MS = 1000;
const CODEX_GATEWAY_REQUEST_TIMEOUT_MS = 60_000;
const CODEX_GATEWAY_TURN_TIMEOUT_MS = 15 * 60 * 1000;
const CODEX_GATEWAY_TURN_POLL_MS = 2500;
export const DEPLOY_GATEWAY_MODEL = "gpt-5.5";
const GATEWAY_SESSION_IDENTIFIER_REGEX =
  /^(?:session[-_][A-Za-z0-9][A-Za-z0-9._:-]{0,95}|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const GATEWAY_TIMESTAMP_MAX_LENGTH = 24;
const GATEWAY_UTC_TIMESTAMP_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const SECRET_LOOKING_VALUE_REGEX =
  /(?:authorization|bearer\s+|credential|password|secret|token|api[_-]?key|^(?:gh[pousr]|github_pat|glpat|sk|xox[baprs])[-_])/i;
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

export interface GatewayContext {
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

export class CodexGatewayTimeoutError extends Error {
  constructor(message = "Codex gateway response timed out.") {
    super(message);
    this.name = "CodexGatewayTimeoutError";
  }
}

export function codexGatewayFailureDetails(
  error: unknown
): DeployTaskFailureDetails {
  if (error instanceof CodexGatewayTimeoutError) {
    return { reason: "gateway-timeout" };
  }
  if (error instanceof CodexGatewayApiError) {
    return {
      httpStatus: error.status,
      reason:
        error.status >= 500 ? "gateway-upstream-error" : "gateway-unavailable",
    };
  }
  if (
    (error instanceof DOMException && error.name === "TimeoutError") ||
    (error instanceof Error &&
      error.message.includes("Codex gateway response timed out"))
  ) {
    return { reason: "gateway-timeout" };
  }
  return { reason: "gateway-unavailable" };
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

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

export function safeGatewaySessionIdentifier(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    hasControlCharacters(value) ||
    SECRET_LOOKING_VALUE_REGEX.test(value) ||
    !GATEWAY_SESSION_IDENTIFIER_REGEX.test(value)
  ) {
    return null;
  }
  return value;
}

function safeGatewayTimestamp(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > GATEWAY_TIMESTAMP_MAX_LENGTH ||
    hasControlCharacters(value) ||
    SECRET_LOOKING_VALUE_REGEX.test(value) ||
    !GATEWAY_UTC_TIMESTAMP_REGEX.test(value)
  ) {
    return null;
  }

  const normalizedValue = value.includes(".")
    ? value
    : value.replace("Z", ".000Z");
  const timestamp = new Date(value);
  return !Number.isNaN(timestamp.getTime()) &&
    timestamp.toISOString() === normalizedValue
    ? value
    : null;
}

export function gatewayStateSnapshot(input: {
  state: Partial<CodexGatewayState>;
}): Record<string, unknown> {
  return {
    activeTurn: input.state.activeTurn === true,
    ready: input.state.ready === true,
    startedAt: safeGatewayTimestamp(input.state.startedAt),
    updatedAt: new Date().toISOString(),
  };
}

export function safeCodexGatewayUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname === ""
    ) {
      return null;
    }
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
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
  const gatewayUrl = safeCodexGatewayUrl(input.gatewayUrl);
  return gatewayUrl ? { authToken: null, url: gatewayUrl } : null;
}

export function getCodexGatewayEventStreamUrl(
  context: GatewayContext,
  sessionId: string
): string {
  const safeSessionId = safeGatewaySessionIdentifier(sessionId);
  if (safeSessionId == null) {
    throw new Error("Invalid Codex gateway session identifier.");
  }
  const url = new URL(
    buildUrl(
      context.url,
      `/api/sessions/${encodeURIComponent(safeSessionId)}/events`
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

export function gatewayEventProjection(eventName: string): {
  kind: string;
  message: string;
  projectsState: boolean;
} {
  switch (eventName) {
    case "message":
      return {
        kind: "deploy_task.gateway_message",
        message: "Codex gateway message event received.",
        projectsState: false,
      };
    case "session":
      return {
        kind: "deploy_task.gateway_session_event",
        message: "Codex gateway session event received.",
        projectsState: false,
      };
    case "state":
      return {
        kind: "deploy_task.gateway_state",
        message: "Codex gateway state updated.",
        projectsState: true,
      };
    default:
      return {
        kind: "deploy_task.gateway_event",
        message: "Codex gateway event received.",
        projectsState: false,
      };
  }
}

async function projectGatewayState(input: {
  state: CodexGatewayState;
  taskId: string;
}): Promise<void> {
  await updateDeployTaskState(input.taskId, {
    gatewayStateSnapshot: gatewayStateSnapshot({ state: input.state }),
  });
}

async function waitForGatewayTurnCompletion(input: {
  context: GatewayContext;
  sessionId: string;
  taskId: string;
}): Promise<CodexGatewayState> {
  const deadline = Date.now() + CODEX_GATEWAY_TURN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // A cancel request aborts the wait between polls; the gateway turn keeps
    // running remotely, but this run stops watching and unwinds to its ack.
    throwIfDeployTaskAborted(input.taskId);
    const sessionState = await getGatewaySessionState(
      input.context,
      input.sessionId
    );
    await projectGatewayState({
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
    phase: "plan",
  });

  throw new CodexGatewayTimeoutError();
}

async function persistGatewayStateEvent(input: {
  payload: Record<string, unknown> | null;
  projection: ReturnType<typeof gatewayEventProjection>;
  taskId: string;
}): Promise<void> {
  const state = (input.payload ?? {}) as Partial<CodexGatewayState> &
    Record<string, unknown>;
  await updateDeployTaskState(input.taskId, {
    gatewayStateSnapshot: gatewayStateSnapshot({ state }),
  });
  await recordDeployTaskEvent(input.taskId, {
    kind: input.projection.kind,
    message: input.projection.message,
    payload: {},
    phase: "plan",
  });
}

export async function persistDeployGatewayEvent(input: {
  eventName: string;
  payload: Record<string, unknown> | null;
  taskId: string;
}): Promise<void> {
  const projection = gatewayEventProjection(input.eventName);
  if (projection.projectsState) {
    await persistGatewayStateEvent({ ...input, projection });
    return;
  }

  await recordDeployTaskEvent(input.taskId, {
    kind: projection.kind,
    message: projection.message,
    payload: {},
    phase: "plan",
  });
}

export async function runDeployTaskGateway(input: {
  context: GatewayContext;
  repairOutput?: boolean;
  task: DeployTaskRow;
}): Promise<void> {
  const gatewayUrl = safeCodexGatewayUrl(input.context.url);
  if (gatewayUrl == null) {
    throw new CodexGatewayApiError("Invalid Codex gateway URL.", 502);
  }
  await updateDeployTaskState(input.task.id, {
    gatewayUrl,
    phase: "plan",
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_waiting",
    message: "Waiting for Codex gateway.",
    phase: "plan",
  });

  await waitForCodexGatewayReady(input.context);

  const session = await createGatewaySession(input.context);
  const sessionId = safeGatewaySessionIdentifier(session.sessionId);
  if (sessionId == null) {
    throw new CodexGatewayApiError(
      "Codex gateway returned an invalid session identifier.",
      502
    );
  }
  await updateDeployTaskState(input.task.id, {
    gatewaySessionId: sessionId,
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_session_created",
    message: "Codex gateway session is ready.",
    payload: {},
    phase: "plan",
  });

  const turn = await sendGatewayTurn(
    input.context,
    sessionId,
    input.repairOutput
      ? buildGatewayRepairPrompt(input.task)
      : buildGatewayPrompt(input.task)
  );
  await updateDeployTaskState(input.task.id, {
    gatewayStateSnapshot: gatewayStateSnapshot({ state: turn.state }),
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_turn_sent",
    message: "Codex gateway turn started.",
    payload: {},
    phase: "plan",
  });

  await waitForGatewayTurnCompletion({
    context: input.context,
    sessionId,
    taskId: input.task.id,
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_turn_completed",
    message: "Codex gateway turn completed.",
    payload: {},
    phase: "generate-artifacts",
  });
}
