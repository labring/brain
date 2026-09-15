"use client";

import useSWR from "swr";

import { sessionFetch } from "@/features/session/session-fetch";
import { SESSION_SWR_KEYS } from "@/features/session/swr-keys";
import { useSessionCredentials } from "@/features/session/use-session-credentials";

import {
  type WorkspaceDetailsResponse,
  workspaceDetailsResponseSchema,
} from "./workspace-details-schema";

export const WORKSPACE_DETAILS_API_PATH = "/api/workspace/details";

/** A failed details read, carrying Brain's status and error code. */
export class WorkspaceDetailsError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string) {
    super(`workspace details ${status} ${code}`);
    this.name = "WorkspaceDetailsError";
    this.code = code;
    this.status = status;
  }
}

async function fetchWorkspaceDetails(
  uid: string
): Promise<WorkspaceDetailsResponse> {
  const response = await sessionFetch(WORKSPACE_DETAILS_API_PATH, {
    body: JSON.stringify({ uid }),
    cache: "no-store",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const code =
      typeof payload === "object" &&
      payload != null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "unknown";
    throw new WorkspaceDetailsError(response.status, code);
  }
  return workspaceDetailsResponseSchema.parse(await response.json());
}

/**
 * The Managed Workspace's members (spec §D.5) through the session fetch
 * (regional token attached, 401 two-step). The key carries the credential
 * fingerprint and the uid, so a re-established session or another
 * selection refetches; null uid reads nothing.
 */
export function useWorkspaceDetails(uid: string | null): {
  data: WorkspaceDetailsResponse | undefined;
  /** A `WorkspaceDetailsError` for a refused read; any other Error otherwise. */
  error: Error | undefined;
} {
  const credentials = useSessionCredentials();
  const { data, error } = useSWR(
    uid == null || credentials.regionalToken === ""
      ? null
      : ([...SESSION_SWR_KEYS.workspaceDetails(credentials), uid] as const),
    ([, , workspaceUid]) => fetchWorkspaceDetails(workspaceUid),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  let failure: Error | undefined;
  if (error instanceof Error) {
    failure = error;
  } else if (error != null) {
    failure = new Error(String(error));
  }
  return { data, error: failure };
}
