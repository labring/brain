import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";
import {
  type CanvasLayoutPatchRequest,
  parseCanvasLayoutDocument,
} from "./contract";
import type { CanvasLayoutDocument, CanvasLayoutNode } from "./types";

export const PROJECT_CANVAS_LAYOUT_API_PATH = "/api/project-canvas/layout";

function errorMessageFromBody(body: unknown): string | undefined {
  if (body == null || typeof body !== "object" || !("error" in body)) {
    return undefined;
  }

  const { error } = body;
  return typeof error === "string" && error.trim() !== "" ? error : undefined;
}

async function jsonOrError<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallback = `Canvas layout request failed (${response.status}).`;
    const body = await response.json().catch(() => undefined);
    const message = errorMessageFromBody(body) ?? fallback;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function fetchProjectCanvasLayout(input: {
  kubeconfig: string;
  namespace: string;
  projectId: string;
}): Promise<CanvasLayoutDocument> {
  const url = new URL(PROJECT_CANVAS_LAYOUT_API_PATH, window.location.origin);
  url.searchParams.set("namespace", input.namespace);
  url.searchParams.set("projectId", input.projectId);

  const raw = await jsonOrError<unknown>(
    await fetch(url, {
      cache: "no-store",
      headers: { Authorization: kubeconfigBearerHeader(input.kubeconfig) },
      method: "GET",
    })
  );
  return parseCanvasLayoutDocument(raw);
}

export async function patchProjectCanvasLayoutNodes(input: {
  kubeconfig: string;
  namespace: string;
  nodes: CanvasLayoutNode[];
  projectId: string;
}): Promise<CanvasLayoutDocument> {
  const body: CanvasLayoutPatchRequest = {
    namespace: input.namespace,
    nodes: input.nodes,
    projectId: input.projectId,
  };
  const raw = await jsonOrError<unknown>(
    await fetch(PROJECT_CANVAS_LAYOUT_API_PATH, {
      body: JSON.stringify(body),
      headers: {
        Authorization: kubeconfigBearerHeader(input.kubeconfig),
        "Content-Type": "application/json",
      },
      method: "PATCH",
    })
  );
  return parseCanvasLayoutDocument(raw);
}
