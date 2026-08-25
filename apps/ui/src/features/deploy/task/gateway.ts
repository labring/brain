import "server-only";

import type { DevboxInfo } from "@/lib/devbox/types";
import {
  buildManagedGatewayPrompt,
  type ManagedDeployResumeMode,
} from "./gateway-prompt";
import {
  deployTaskRunSignal,
  recordDeployTaskEvent,
  throwIfDeployTaskAborted,
  updateDeployTaskState,
} from "./runner-writes";
import type { DeployTaskFailureDetails, DeployTaskRow } from "./schema";
import {
  DEPLOY_TIMEOUT_POLICY,
  remainingDeploymentTimeoutMs,
} from "./timeout-policy";

const CODEX_GATEWAY_STARTUP_RETRY_MS = 1000;
export const DEPLOY_GATEWAY_MODEL = "gpt-5.5";

export function resolveDeployGatewayModel(): string {
  const configured = process.env.CODEX_GATEWAY_MODEL?.trim();
  return configured ? configured : DEPLOY_GATEWAY_MODEL;
}

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

type CodexGatewayFailedTurnStatus =
  | "cancelled"
  | "failed"
  | "interrupted"
  | "unknown";

export class CodexGatewayTurnError extends Error {
  status: CodexGatewayFailedTurnStatus;

  constructor(status: CodexGatewayFailedTurnStatus) {
    super("Codex gateway turn did not complete successfully.");
    this.name = "CodexGatewayTurnError";
    this.status = status;
  }
}

function failedGatewayTurnStatus(
  value: string | null | undefined
): CodexGatewayFailedTurnStatus | null {
  switch (value?.trim().toLowerCase()) {
    case "completed":
      return null;
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "failed":
    case "error":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "unknown";
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
  if (error instanceof CodexGatewayTurnError) {
    return { reason: "gateway-upstream-error" };
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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
  init?: RequestInit,
  deadlineAtMs?: number,
  runSignal?: AbortSignal
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("content-type") && init?.body != null) {
    headers.set("content-type", "application/json");
  }
  if (context.authToken != null) {
    headers.set("authorization", `Bearer ${context.authToken}`);
  }

  const requestDeadlineAtMs =
    deadlineAtMs ?? Date.now() + DEPLOY_TIMEOUT_POLICY.gatewayRequestMs;
  const requestTimeoutMs = remainingDeploymentTimeoutMs({
    capMs: DEPLOY_TIMEOUT_POLICY.gatewayRequestMs,
    deadlineAtMs: requestDeadlineAtMs,
  });
  if (requestTimeoutMs <= 0) {
    throw new CodexGatewayTimeoutError();
  }

  const requestSignals = [
    AbortSignal.timeout(Math.max(1, requestTimeoutMs)),
    ...(init?.signal == null ? [] : [init.signal]),
    ...(runSignal == null ? [] : [runSignal]),
  ];
  const response = await fetch(buildUrl(context.url, path), {
    ...init,
    cache: "no-store",
    headers,
    signal:
      requestSignals.length === 1
        ? requestSignals[0]
        : AbortSignal.any(requestSignals),
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
  context: GatewayContext,
  deadlineAtMs: number,
  runSignal: AbortSignal
): Promise<void> {
  const deadline = Math.min(
    deadlineAtMs,
    Date.now() + DEPLOY_TIMEOUT_POLICY.gatewayStartupMs
  );
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      const health = await gatewayRequest<CodexGatewayHealth>(
        context,
        "/healthz",
        undefined,
        deadline,
        runSignal
      );
      const ready = await gatewayRequest<CodexGatewayReady>(
        context,
        "/readyz",
        undefined,
        deadline,
        runSignal
      );
      if (health.ok && ready.ok) {
        return;
      }
      lastError = new Error("Codex gateway is not ready.");
    } catch (error) {
      if (runSignal.aborted) {
        throw runSignal.reason instanceof Error ? runSignal.reason : error;
      }
      lastError = error;
    }
    await sleep(
      Math.min(
        CODEX_GATEWAY_STARTUP_RETRY_MS,
        Math.max(0, deadline - Date.now())
      ),
      runSignal
    );
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Codex gateway startup check timed out.");
}

async function createGatewaySession(
  context: GatewayContext,
  deadlineAtMs: number,
  runSignal: AbortSignal,
  options?: {
    threadId?: string | null;
  }
): Promise<CodexGatewaySessionResponse> {
  return await gatewayRequest<CodexGatewaySessionResponse>(
    context,
    "/api/sessions",
    {
      body: JSON.stringify({
        model: resolveDeployGatewayModel(),
        ...(options?.threadId == null ? {} : { threadId: options.threadId }),
      }),
      method: "POST",
    },
    deadlineAtMs,
    runSignal
  );
}

async function resolveGatewaySession(input: {
  context: GatewayContext;
  deadlineAtMs: number;
  existingSessionId?: string | null;
  existingThreadId?: string | null;
  runSignal: AbortSignal;
}): Promise<{
  created: boolean;
  sessionId: string;
  state: CodexGatewayState;
}> {
  const requestedSessionId = input.existingSessionId;
  if (requestedSessionId != null) {
    const existingSessionId = safeGatewaySessionIdentifier(requestedSessionId);
    if (existingSessionId == null) {
      throw new CodexGatewayApiError(
        "Invalid existing Codex gateway session identifier.",
        502
      );
    }
    try {
      const existing = await getGatewaySessionState(
        input.context,
        existingSessionId,
        input.deadlineAtMs,
        input.runSignal
      );
      return {
        created: false,
        sessionId: existingSessionId,
        state: existing.state,
      };
    } catch (error) {
      if (
        !(error instanceof CodexGatewayApiError) ||
        (error.status !== 404 && error.status !== 410)
      ) {
        throw error;
      }
      if (input.existingThreadId == null) {
        throw new CodexGatewayApiError(
          "Codex gateway session was lost and no resumable Thread is recorded.",
          409
        );
      }
    }
  }

  const session = await createGatewaySession(
    input.context,
    input.deadlineAtMs,
    input.runSignal,
    {
      threadId: input.existingThreadId,
    }
  );
  const sessionId = safeGatewaySessionIdentifier(session.sessionId);
  if (sessionId == null) {
    throw new CodexGatewayApiError(
      "Codex gateway returned an invalid session identifier.",
      502
    );
  }
  return { created: true, sessionId, state: session.state };
}

async function sendGatewayTurn(
  context: GatewayContext,
  sessionId: string,
  prompt: string,
  deadlineAtMs: number,
  runSignal: AbortSignal
): Promise<CodexGatewaySessionResponse> {
  return await gatewayRequest<CodexGatewaySessionResponse>(
    context,
    `/api/sessions/${encodeURIComponent(sessionId)}/turn`,
    {
      body: JSON.stringify({ prompt }),
      method: "POST",
    },
    deadlineAtMs,
    runSignal
  );
}

async function getGatewaySessionState(
  context: GatewayContext,
  sessionId: string,
  deadlineAtMs: number,
  runSignal?: AbortSignal
): Promise<CodexGatewaySessionResponse> {
  return await gatewayRequest<CodexGatewaySessionResponse>(
    context,
    `/api/sessions/${encodeURIComponent(sessionId)}/state`,
    undefined,
    deadlineAtMs,
    runSignal
  );
}

async function requestCodexGatewayTurnInterrupt(
  context: GatewayContext,
  sessionId: string,
  deadlineAtMs: number
): Promise<CodexGatewaySessionResponse> {
  return await gatewayRequest<CodexGatewaySessionResponse>(
    context,
    `/api/sessions/${encodeURIComponent(sessionId)}/turn/interrupt`,
    {
      body: JSON.stringify({}),
      method: "POST",
    },
    deadlineAtMs
  );
}

async function recordGatewayInterruptEvent(input: {
  httpStatus?: number;
  outcome: "failed" | "requested" | "settled";
  taskId: string;
}): Promise<void> {
  const presentation = {
    failed: {
      kind: "deploy_task.gateway_interrupt_failed",
      message: "Codex gateway turn interrupt failed.",
    },
    requested: {
      kind: "deploy_task.gateway_interrupt_requested",
      message: "Codex gateway turn interrupt was requested.",
    },
    settled: {
      kind: "deploy_task.gateway_turn_settled",
      message: "Codex gateway turn was already settled.",
    },
  }[input.outcome];
  await recordDeployTaskEvent(input.taskId, {
    kind: presentation.kind,
    message: presentation.message,
    payload: input.httpStatus == null ? {} : { httpStatus: input.httpStatus },
    phase: "plan",
  }).catch(() => undefined);
}

interface GatewayInterruptAttempt {
  httpStatus?: number;
  outcome: "failed" | "requested" | "retry" | "settled";
}

function gatewayHttpStatus(error: unknown): number | undefined {
  return error instanceof CodexGatewayApiError ? error.status : undefined;
}

async function attemptCodexGatewayTurnInterrupt(input: {
  context: GatewayContext;
  deadlineAtMs: number;
  sessionId: string;
  turnSubmissionConfirmed: boolean;
}): Promise<GatewayInterruptAttempt> {
  try {
    await requestCodexGatewayTurnInterrupt(
      input.context,
      input.sessionId,
      input.deadlineAtMs
    );
    return { outcome: "requested" };
  } catch (error) {
    if (!(error instanceof CodexGatewayApiError)) {
      return { outcome: "failed" };
    }
    if (error.status === 404) {
      return { httpStatus: error.status, outcome: "settled" };
    }
    if (error.status !== 409) {
      return { httpStatus: error.status, outcome: "failed" };
    }

    try {
      const state = await getGatewaySessionState(
        input.context,
        input.sessionId,
        input.deadlineAtMs
      );
      return {
        httpStatus: error.status,
        outcome:
          state.state.activeTurn || !input.turnSubmissionConfirmed
            ? "retry"
            : "settled",
      };
    } catch (stateError) {
      if (
        stateError instanceof CodexGatewayApiError &&
        stateError.status === 404
      ) {
        return { httpStatus: stateError.status, outcome: "settled" };
      }
      return {
        httpStatus: gatewayHttpStatus(stateError) ?? error.status,
        outcome: "retry",
      };
    }
  }
}

async function interruptCodexGatewayTurnBestEffort(input: {
  context: GatewayContext;
  sessionId: string;
  taskId: string;
  turnSubmissionConfirmed: boolean;
}): Promise<boolean> {
  const deadlineAtMs = Date.now() + DEPLOY_TIMEOUT_POLICY.gatewayCleanupMs;
  let lastHttpStatus: number | undefined;

  while (Date.now() < deadlineAtMs) {
    const attempt = await attemptCodexGatewayTurnInterrupt({
      context: input.context,
      deadlineAtMs,
      sessionId: input.sessionId,
      turnSubmissionConfirmed: input.turnSubmissionConfirmed,
    });
    lastHttpStatus = attempt.httpStatus;

    if (attempt.outcome === "requested" || attempt.outcome === "settled") {
      await recordGatewayInterruptEvent({
        httpStatus: attempt.httpStatus,
        outcome: attempt.outcome,
        taskId: input.taskId,
      });
      return true;
    }
    if (attempt.outcome === "failed") {
      break;
    }
    await sleep(Math.min(100, Math.max(0, deadlineAtMs - Date.now())));
  }

  console.warn(
    `[deploy-task] Codex gateway interrupt failed for ${input.taskId}.`,
    lastHttpStatus == null ? {} : { httpStatus: lastHttpStatus }
  );
  await recordGatewayInterruptEvent({
    httpStatus: lastHttpStatus,
    outcome: "failed",
    taskId: input.taskId,
  });
  return false;
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
    ...(input.state.threadId == null
      ? {}
      : { gatewayThreadId: input.state.threadId }),
  });
}

async function waitForGatewayTurnCompletion(input: {
  context: GatewayContext;
  deadlineAtMs: number;
  onPoll?: () => Promise<void>;
  runSignal: AbortSignal;
  sessionId: string;
  taskId: string;
}): Promise<CodexGatewayState> {
  while (Date.now() < input.deadlineAtMs) {
    // The outer turn boundary handles a local abort by interrupting the remote
    // turn before it rethrows the run's original cancellation or timeout.
    throwIfDeployTaskAborted(input.taskId);
    const sessionState = await getGatewaySessionState(
      input.context,
      input.sessionId,
      input.deadlineAtMs,
      input.runSignal
    );
    await input.onPoll?.();
    await projectGatewayState({
      state: sessionState.state,
      taskId: input.taskId,
    });

    if (!sessionState.state.activeTurn) {
      const failedStatus = failedGatewayTurnStatus(
        sessionState.state.lastTurnStatus
      );
      if (failedStatus != null) {
        throw new CodexGatewayTurnError(failedStatus);
      }
      return sessionState.state;
    }

    await sleep(
      Math.min(
        DEPLOY_TIMEOUT_POLICY.gatewayPollMs,
        Math.max(0, input.deadlineAtMs - Date.now())
      ),
      input.runSignal
    );
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
  deadlineAtMs: number;
  existingSessionId?: string | null;
  onPoll?: () => Promise<void>;
  repairFindings?: readonly string[];
  resumeMode: ManagedDeployResumeMode;
  task: DeployTaskRow;
}): Promise<string> {
  let managedPhase: "apply" | "plan" | "verify" = "plan";
  if (input.resumeMode === "repair") {
    managedPhase = "apply";
  }
  const runSignal = deployTaskRunSignal(input.task.id);
  throwIfDeployTaskAborted(input.task.id);
  const gatewayUrl = safeCodexGatewayUrl(input.context.url);
  if (gatewayUrl == null) {
    throw new CodexGatewayApiError("Invalid Codex gateway URL.", 502);
  }
  await updateDeployTaskState(input.task.id, {
    gatewayUrl,
    phase: managedPhase,
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_waiting",
    message: "Waiting for Codex gateway.",
    phase: managedPhase,
  });

  await waitForCodexGatewayReady(input.context, input.deadlineAtMs, runSignal);

  const session = await resolveGatewaySession({
    context: input.context,
    deadlineAtMs: input.deadlineAtMs,
    existingSessionId:
      input.existingSessionId ?? input.task.gatewaySessionId ?? null,
    existingThreadId: input.task.gatewayThreadId,
    runSignal,
  });
  const { sessionId } = session;
  await updateDeployTaskState(input.task.id, {
    gatewaySessionId: sessionId,
    gatewayThreadId: session.state.threadId ?? input.task.gatewayThreadId,
  });
  await recordDeployTaskEvent(input.task.id, {
    kind: session.created
      ? "deploy_task.gateway_session_created"
      : "deploy_task.gateway_session_resumed",
    message: session.created
      ? "Codex gateway session is ready."
      : "Codex gateway session was resumed.",
    payload: {},
    phase: managedPhase,
  });

  if (!session.created && session.state.activeTurn) {
    await waitForGatewayTurnCompletion({
      context: input.context,
      deadlineAtMs: input.deadlineAtMs,
      runSignal,
      sessionId,
      taskId: input.task.id,
      onPoll: input.onPoll,
    });
    await recordDeployTaskEvent(input.task.id, {
      kind: "deploy_task.gateway_turn_completed",
      message: "Recovered Codex gateway turn completed.",
      payload: {},
      phase: managedPhase,
    });
    return sessionId;
  }

  let turnMayBeActive = false;
  let turnSubmissionConfirmed = false;
  let interruptPromise: Promise<boolean> | undefined;
  const turnBoundarySignal = AbortSignal.any([
    runSignal,
    AbortSignal.timeout(
      Math.max(
        1,
        remainingDeploymentTimeoutMs({ deadlineAtMs: input.deadlineAtMs })
      )
    ),
  ]);
  const interruptTurnOnce = (): Promise<boolean> => {
    if (!turnMayBeActive) {
      return Promise.resolve(false);
    }
    interruptPromise ??= interruptCodexGatewayTurnBestEffort({
      context: input.context,
      sessionId,
      taskId: input.task.id,
      turnSubmissionConfirmed,
    });
    return interruptPromise;
  };
  const interruptOnBoundary = () => {
    interruptTurnOnce().catch(() => undefined);
  };
  turnBoundarySignal.addEventListener("abort", interruptOnBoundary, {
    once: true,
  });
  try {
    // Set this before sending: the gateway may accept the turn even if the
    // client loses the response or its local signal aborts.
    turnMayBeActive = true;
    if (turnBoundarySignal.aborted) {
      interruptOnBoundary();
    }
    const prompt = buildManagedGatewayPrompt({
      repairFindings: input.repairFindings,
      resumeMode: input.resumeMode,
      task: input.task,
    });
    const turn = await sendGatewayTurn(
      input.context,
      sessionId,
      prompt,
      input.deadlineAtMs,
      runSignal
    );
    turnSubmissionConfirmed = true;
    await updateDeployTaskState(input.task.id, {
      gatewayStateSnapshot: gatewayStateSnapshot({ state: turn.state }),
    });
    await recordDeployTaskEvent(input.task.id, {
      kind: "deploy_task.gateway_turn_sent",
      message: "Codex gateway turn started.",
      payload: {},
      phase: managedPhase,
    });

    await waitForGatewayTurnCompletion({
      context: input.context,
      deadlineAtMs: input.deadlineAtMs,
      runSignal,
      sessionId,
      taskId: input.task.id,
      onPoll: input.onPoll,
    });
    turnMayBeActive = false;
  } catch (error) {
    if (turnMayBeActive && !(error instanceof CodexGatewayTurnError)) {
      await interruptTurnOnce();
    }
    throw error;
  } finally {
    turnBoundarySignal.removeEventListener("abort", interruptOnBoundary);
  }
  await recordDeployTaskEvent(input.task.id, {
    kind: "deploy_task.gateway_turn_completed",
    message: "Codex gateway turn completed.",
    payload: {},
    phase: managedPhase,
  });
  return sessionId;
}
