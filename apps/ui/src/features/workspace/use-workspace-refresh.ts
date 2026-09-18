"use client";

import { useStore } from "jotai";
import { useCallback } from "react";
import { useSWRConfig } from "swr";

import { SESSION_SWR_KEYS } from "@/features/session/swr-keys";
import { useSessionCredentials } from "@/features/session/use-session-credentials";
import { currentWorkspaceAtom, workspacesAtom } from "@/lib/auth-store";

import { workspaceListResponseSchema } from "./workspace-list-schema";

const WORKSPACE_DETAILS_KEY_HEAD = SESSION_SWR_KEYS.workspaceDetails({
  appToken: "",
  kubeconfig: "",
  namespace: "",
  regionalToken: "",
})[0];

/**
 * Convergence after a write (spec §D.8): re-read `list` and `details` from
 * Desktop rather than trusting an optimistic guess (the DB is the truth,
 * the RoleBinding may lag). The fresh list is also written back to the
 * session atoms, so the Switcher shows a rename at once and a transfer of
 * the current Workspace re-gates everything that reads the current role.
 */
export function useWorkspaceRefresh(): (options?: {
  /** Re-read the cached member tables too (false after a delete or leave). */
  details?: boolean;
}) => Promise<void> {
  const { mutate } = useSWRConfig();
  const credentials = useSessionCredentials();
  const store = useStore();
  return useCallback(
    async (options = {}) => {
      const fresh = await mutate(
        SESSION_SWR_KEYS.workspaceList(credentials)
      ).catch(() => undefined);
      const parsed = workspaceListResponseSchema.safeParse(fresh);
      if (parsed.success) {
        store.set(workspacesAtom, parsed.data);
        const current = store.get(currentWorkspaceAtom);
        const refreshed =
          current == null
            ? undefined
            : parsed.data.find((workspace) => workspace.uid === current.uid);
        if (refreshed != null) {
          store.set(currentWorkspaceAtom, refreshed);
        }
      }
      if (options.details !== false) {
        await mutate(
          (key) => Array.isArray(key) && key[0] === WORKSPACE_DETAILS_KEY_HEAD
        ).catch(() => undefined);
      }
    },
    [credentials, mutate, store]
  );
}
