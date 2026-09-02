"use client";

import { appTokenRequestHeaders } from "@/lib/app-token-header";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import type {
  DeploymentTaskProjection,
  DeploymentTaskProjectionStreamEvent,
  DeploymentTaskProjectionStreamServerEvent,
} from "./projection";
import type {
  DeploymentTaskSource,
  DeploymentTaskTimelineSnapshotDTO,
  DeploymentTaskTimelineStreamEvent,
  DeploymentTaskTimelineStreamServerEvent,
  DeployTaskDTO,
  UpdateDeployTaskCanvasProjectionInput,
} from "./types";

export const DEPLOY_TASKS_API_PATH = "/api/deploy-tasks";
export const DEPLOY_TASK_PROJECTIONS_STREAM_API_PATH =
  "/api/deploy-task-projections/stream";

const SSE_LINE_SEPARATOR_REGEX = /\r?\n/;
const SSE_BLOCK_SEPARATOR_REGEX = /\r?\n\r?\n/;

function errorMessageFromBody(body: unknown): string | undefined {
  if (body == null || typeof body !== "object" || !("error" in body)) {
    return undefined;
  }
  const error = (body as { error?: unknown }).error;
  return typeof error === "string" && error.trim() !== "" ? error : undefined;
}

async function jsonOrError<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallback = `Deploy task request failed (${response.status}).`;
    const body = await response.json().catch(() => undefined);
    throw new Error(errorMessageFromBody(body) ?? fallback);
  }
  return (await response.json()) as T;
}

export async function fetchProjectDeploymentTaskProjections(input: {
  kubeconfig: string;
  namespace: string;
  projectId: string;
}): Promise<DeploymentTaskProjection[]> {
  const url = new URL(DEPLOY_TASKS_API_PATH, window.location.origin);
  url.searchParams.set("namespace", input.namespace);
  url.searchParams.set("projectId", input.projectId);
  const body = await jsonOrError<{ projections?: DeploymentTaskProjection[] }>(
    await fetch(url, {
      cache: "no-store",
      headers: {
        Authorization: kubeconfigBearerHeader(input.kubeconfig),
      },
      method: "GET",
    })
  );
  return Array.isArray(body.projections) ? body.projections : [];
}

function parseSseEventBlock(block: string): string | null {
  if (!block.trim() || block.trimStart().startsWith(":")) {
    return null;
  }

  const dataLines: string[] = [];
  for (const line of block.split(SSE_LINE_SEPARATOR_REGEX)) {
    if (line.startsWith("event:")) {
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return dataLines.join("\n");
}

function flushSseEventBlocks(input: {
  buffer: string;
  onEvent: (event: DeploymentTaskProjectionStreamEvent) => void;
}): string {
  let buffer = input.buffer;
  while (true) {
    const match = buffer.match(SSE_BLOCK_SEPARATOR_REGEX);
    if (match?.index == null) {
      return buffer;
    }

    const block = buffer.slice(0, match.index);
    buffer = buffer.slice(match.index + match[0].length);
    const dataText = parseSseEventBlock(block);
    if (dataText) {
      const event = JSON.parse(
        dataText
      ) as DeploymentTaskProjectionStreamServerEvent;
      if (event.type === "error") {
        throw new Error(event.message || "Deployment task stream failed.");
      }
      input.onEvent(event);
    }
  }
}

function deployTaskTimelineApiPath(taskId: string): string {
  return `${DEPLOY_TASKS_API_PATH}/${encodeURIComponent(taskId)}/timeline`;
}

function deployTaskTimelineStreamApiPath(taskId: string): string {
  return `${deployTaskTimelineApiPath(taskId)}/stream`;
}

function flushTimelineSseEventBlocks(input: {
  buffer: string;
  onEvent: (event: DeploymentTaskTimelineStreamEvent) => void;
}): string {
  let buffer = input.buffer;
  while (true) {
    const match = buffer.match(SSE_BLOCK_SEPARATOR_REGEX);
    if (match?.index == null) {
      return buffer;
    }

    const block = buffer.slice(0, match.index);
    buffer = buffer.slice(match.index + match[0].length);
    const dataText = parseSseEventBlock(block);
    if (dataText) {
      const event = JSON.parse(
        dataText
      ) as DeploymentTaskTimelineStreamServerEvent;
      if (event.type === "error") {
        throw new Error(event.message || "Deployment task timeline failed.");
      }
      input.onEvent(event);
    }
  }
}

export async function fetchDeploymentTaskTimeline(input: {
  kubeconfig: string;
  namespace: string;
  taskId: string;
}): Promise<DeploymentTaskTimelineSnapshotDTO> {
  const url = new URL(
    deployTaskTimelineApiPath(input.taskId),
    window.location.origin
  );
  url.searchParams.set("namespace", input.namespace);
  return await jsonOrError<DeploymentTaskTimelineSnapshotDTO>(
    await fetch(url, {
      cache: "no-store",
      headers: {
        Authorization: kubeconfigBearerHeader(input.kubeconfig),
      },
      method: "GET",
    })
  );
}

export async function streamDeploymentTaskTimeline(input: {
  kubeconfig: string;
  namespace: string;
  onEvent: (event: DeploymentTaskTimelineStreamEvent) => void;
  signal: AbortSignal;
  taskId: string;
}): Promise<void> {
  const url = new URL(
    deployTaskTimelineStreamApiPath(input.taskId),
    window.location.origin
  );
  url.searchParams.set("namespace", input.namespace);

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/event-stream",
      Authorization: kubeconfigBearerHeader(input.kubeconfig),
    },
    signal: input.signal,
  });
  if (!response.ok || response.body == null) {
    throw new Error(
      `Deployment task timeline stream returned ${response.status}.`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!input.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value == null) {
        continue;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = flushTimelineSseEventBlocks({
        buffer,
        onEvent: input.onEvent,
      });
    }
    buffer += decoder.decode();
    flushTimelineSseEventBlocks({
      buffer,
      onEvent: input.onEvent,
    });
    if (!input.signal.aborted) {
      throw new Error("Deployment task timeline stream closed.");
    }
  } finally {
    reader.releaseLock();
  }
}

export async function streamProjectDeploymentTaskProjections(input: {
  kubeconfig: string;
  namespace: string;
  onEvent: (event: DeploymentTaskProjectionStreamEvent) => void;
  projectId: string;
  signal: AbortSignal;
}): Promise<void> {
  const url = new URL(
    DEPLOY_TASK_PROJECTIONS_STREAM_API_PATH,
    window.location.origin
  );
  url.searchParams.set("namespace", input.namespace);
  url.searchParams.set("projectId", input.projectId);

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "text/event-stream",
      Authorization: kubeconfigBearerHeader(input.kubeconfig),
    },
    signal: input.signal,
  });
  if (!response.ok || response.body == null) {
    throw new Error(`Deployment task stream returned ${response.status}.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!input.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value == null) {
        continue;
      }
      buffer += decoder.decode(value, { stream: true });
      buffer = flushSseEventBlocks({
        buffer,
        onEvent: input.onEvent,
      });
    }
    buffer += decoder.decode();
    flushSseEventBlocks({
      buffer,
      onEvent: input.onEvent,
    });
    if (!input.signal.aborted) {
      throw new Error("Deployment task stream closed.");
    }
  } finally {
    reader.releaseLock();
  }
}

export async function patchDeployTaskCanvasProjection(input: {
  kubeconfig: string;
  namespace: string;
  taskId: string;
  update: UpdateDeployTaskCanvasProjectionInput;
}): Promise<DeployTaskDTO> {
  const url = new URL(
    `${DEPLOY_TASKS_API_PATH}/${encodeURIComponent(input.taskId)}`,
    window.location.origin
  );
  url.searchParams.set("namespace", input.namespace);
  const body = await jsonOrError<{ task?: DeployTaskDTO }>(
    await fetch(url, {
      body: JSON.stringify(input.update),
      headers: {
        Authorization: kubeconfigBearerHeader(input.kubeconfig),
        "Content-Type": "application/json",
      },
      method: "PATCH",
    })
  );
  if (body.task == null) {
    throw new Error("Deploy task response did not include a task.");
  }
  return body.task;
}

export interface DeployTaskActionResult {
  /** 409: the intent can no longer be satisfied; snapshot carries truth. */
  conflict: boolean;
  task: DeployTaskDTO | null;
}

async function actionResultOrError(
  response: Response,
  fallback: string
): Promise<DeployTaskActionResult> {
  const body = (await response.json().catch(() => undefined)) as
    | { error?: unknown; task?: DeployTaskDTO }
    | undefined;
  if (response.ok) {
    return { conflict: false, task: body?.task ?? null };
  }
  if (response.status === 409) {
    return { conflict: true, task: body?.task ?? null };
  }
  throw new Error(
    errorMessageFromBody(body) ?? `${fallback} (${response.status}).`
  );
}

/**
 * Two-phase cancel (ADR 0038): success may mean cancelled or "cancelling";
 * a 409 carries the terminal snapshot so surfaces reconcile without toasts.
 */
export async function cancelDeploymentTask(input: {
  kubeconfig: string;
  namespace: string;
  taskId: string;
}): Promise<DeployTaskActionResult> {
  const url = new URL(
    `${DEPLOY_TASKS_API_PATH}/${encodeURIComponent(input.taskId)}/cancel`,
    window.location.origin
  );
  url.searchParams.set("namespace", input.namespace);
  return await actionResultOrError(
    await fetch(url, {
      headers: {
        Authorization: kubeconfigBearerHeader(input.kubeconfig),
      },
      method: "POST",
    }),
    "Deploy task cancel failed"
  );
}

/**
 * Redeploy is task creation from a failed/cancelled predecessor (ADR 0038).
 * A 409 carries the already-active recovery attempt (or the non-terminal
 * predecessor); callers reconcile from that snapshot.
 *
 * Redeploy of a GitHub predecessor proves the initiator for its personal
 * credential binding. Namespace-shared predecessors send the token too (for
 * the billing reverse-check and consent provenance) but never fail closed on
 * it: an unverifiable actor still redeploys, unattributed.
 */
export async function redeployDeploymentTask(input: {
  appToken: string;
  kubeconfig: string;
  namespace: string;
  predecessorSourceKind: DeploymentTaskSource["kind"];
  predecessorTaskId: string;
}): Promise<DeployTaskActionResult> {
  const url = new URL(DEPLOY_TASKS_API_PATH, window.location.origin);
  return await actionResultOrError(
    await fetch(url, {
      body: JSON.stringify({
        encodedKubeconfig: input.kubeconfig,
        namespace: input.namespace,
        predecessorTaskId: input.predecessorTaskId,
      }),
      headers: {
        Authorization: kubeconfigBearerHeader(input.kubeconfig),
        "Content-Type": "application/json",
        // Every predecessor kind sends the token when one is hydrated: the
        // rerun's terminal failure needs a Workspace Actor to reverse-check
        // billing (ADR-0068's chokepoint), and a proven same-person actor is
        // also what lets the engine keep consent provenance. Only a GitHub
        // predecessor fails closed on it server-side.
        ...appTokenRequestHeaders(input.appToken),
      },
      method: "POST",
    }),
    "Redeploy failed"
  );
}
