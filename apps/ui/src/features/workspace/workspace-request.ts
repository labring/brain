import type { z } from "zod";

import { sessionFetch } from "@/features/session/session-fetch";

/**
 * The page's side of the `/api/workspace/*` boundary: every read and write
 * goes through the session fetch (regional token attached, 401 two-step)
 * and a refused answer becomes a `WorkspaceRequestError` carrying Brain's
 * status and error code, which the Workspace Area keys its reaction on —
 * a 403 / 404 means the actor's standing changed under them (spec §D.8).
 */
export class WorkspaceRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(path: string, status: number, code: string) {
    super(`${path} ${status} ${code}`);
    this.name = "WorkspaceRequestError";
    this.code = code;
    this.status = status;
  }

  /** Desktop refused the actor: their role or membership changed. */
  get standingChanged(): boolean {
    return this.status === 403 || this.status === 404;
  }
}

async function errorCodeOf(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  return typeof payload === "object" &&
    payload != null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : "unknown";
}

/** `POST path` with a JSON body, the answer validated against `schema`. */
export async function postWorkspaceJson<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>
): Promise<T> {
  const response = await sessionFetch(path, {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new WorkspaceRequestError(
      path,
      response.status,
      await errorCodeOf(response)
    );
  }
  return schema.parse(await response.json());
}
