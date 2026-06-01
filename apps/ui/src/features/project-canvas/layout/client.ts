import {
  type CanvasLayoutPatchRequest,
  canvasLayoutDocumentSchema,
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
  namespace: string;
  projectUid: string;
}): Promise<CanvasLayoutDocument> {
  const url = new URL(PROJECT_CANVAS_LAYOUT_API_PATH, window.location.origin);
  url.searchParams.set("namespace", input.namespace);
  url.searchParams.set("projectUid", input.projectUid);

  const raw = await jsonOrError<unknown>(
    await fetch(url, { method: "GET", cache: "no-store" })
  );
  return canvasLayoutDocumentSchema.parse(raw);
}

export async function patchProjectCanvasLayoutNodes(input: {
  namespace: string;
  nodes: CanvasLayoutNode[];
  projectUid: string;
}): Promise<CanvasLayoutDocument> {
  const body: CanvasLayoutPatchRequest = {
    namespace: input.namespace,
    nodes: input.nodes,
    projectUid: input.projectUid,
  };
  const raw = await jsonOrError<unknown>(
    await fetch(PROJECT_CANVAS_LAYOUT_API_PATH, {
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    })
  );
  return canvasLayoutDocumentSchema.parse(raw);
}
