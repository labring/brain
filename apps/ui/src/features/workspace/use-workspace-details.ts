"use client";

import useSWR from "swr";

import { SESSION_SWR_KEYS } from "@/features/session/swr-keys";
import { useSessionCredentials } from "@/features/session/use-session-credentials";

import { WORKSPACE_ROUTES } from "./server/workspace-route-table";
import {
  type WorkspaceDetailsResponse,
  workspaceDetailsResponseSchema,
} from "./workspace-details-schema";
import { postWorkspaceJson } from "./workspace-request";

function fetchWorkspaceDetails(uid: string): Promise<WorkspaceDetailsResponse> {
  return postWorkspaceJson(
    WORKSPACE_ROUTES.details.apiPath,
    { uid },
    workspaceDetailsResponseSchema
  );
}

/**
 * The Managed Workspace's members (spec §D.5) through the session fetch
 * (regional token attached, 401 two-step). The key carries the credential
 * fingerprint and the uid, so a re-established session or another
 * selection refetches; null uid reads nothing.
 */
export function useWorkspaceDetails(uid: string | null): {
  data: WorkspaceDetailsResponse | undefined;
  /** A `WorkspaceRequestError` for a refused read; any other Error otherwise. */
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
