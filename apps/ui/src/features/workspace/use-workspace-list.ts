"use client";

import { useAtomValue } from "jotai";
import useSWR from "swr";

import { sessionFetch } from "@/features/session/session-fetch";
import { SESSION_SWR_KEYS } from "@/features/session/swr-keys";
import { useSessionCredentials } from "@/features/session/use-session-credentials";
import { workspacesAtom } from "@/lib/auth-store";

import type { WorkspaceListResponse } from "./workspace-list-schema";
import { workspaceListResponseSchema } from "./workspace-list-schema";

export const WORKSPACE_LIST_API_PATH = "/api/workspace/list";

async function fetchWorkspaceList(): Promise<WorkspaceListResponse> {
  const response = await sessionFetch(WORKSPACE_LIST_API_PATH, {
    cache: "no-store",
    method: "GET",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`workspace list ${response.status}`);
  }
  return workspaceListResponseSchema.parse(await response.json());
}

/**
 * The user's Workspaces in this region (spec §C.5): the Brain Session's
 * list as the fallback, kept fresh by `GET /api/workspace/list` through the
 * session fetch (regional token attached, 401 two-step). The key carries
 * the credential fingerprint, so a re-established session refetches.
 */
export function useWorkspaceList(): WorkspaceListResponse {
  const credentials = useSessionCredentials();
  const sessionWorkspaces = useAtomValue(workspacesAtom);
  const { data } = useSWR(
    credentials.regionalToken === ""
      ? null
      : SESSION_SWR_KEYS.workspaceList(credentials),
    fetchWorkspaceList,
    {
      fallbackData: sessionWorkspaces,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
  return data ?? sessionWorkspaces;
}
