"use client";

import useSWR from "swr";

import {
  loadWorkspacePlans,
  type WorkspacePlans,
} from "@/features/billing/workspace-plans-data";
import { SESSION_SWR_KEYS } from "@/features/session/swr-keys";
import { useSessionCredentials } from "@/features/session/use-session-credentials";

/**
 * The plan name per Workspace for the Switcher's badges (spec §C.5). The
 * key embeds the credential fingerprint (the cache invariant) and the ids
 * read, so a Workspace joining the list is read too. Undefined while
 * loading or after a failed route: no badge on any row.
 */
export function useWorkspacePlans(
  workspaceIds: readonly string[]
): WorkspacePlans | undefined {
  const credentials = useSessionCredentials();
  const { appToken, kubeconfig } = credentials;
  const idsKey = workspaceIds.join(",");
  const { data } = useSWR(
    credentials.ready && workspaceIds.length > 0
      ? ([
          ...SESSION_SWR_KEYS.billingWorkspacePlans(credentials),
          idsKey,
        ] as const)
      : null,
    () => loadWorkspacePlans({ appToken, kubeconfig }, idsKey.split(",")),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
  return data;
}
