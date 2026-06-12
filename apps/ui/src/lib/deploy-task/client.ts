"use client";

import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import type {
  DeploymentTaskProjection,
  DeploymentTaskProjectionStreamEvent,
  DeploymentTaskProjectionStreamServerEvent,
} from "./projection";
import type {
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
