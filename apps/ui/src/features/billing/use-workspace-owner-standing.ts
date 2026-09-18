"use client";

import useSWR from "swr";

import { SESSION_SWR_KEYS } from "@/features/session/swr-keys";
import { useSessionCredentials } from "@/features/session/use-session-credentials";

import { loadWorkspaceOwnerStanding } from "./workspace-owner-data";

/**
 * The shared client read of the Workspace Owner standing (ADR-0082): the
 * status hint inputs and the Billing Area's Plan view key on the same SWR
 * entry, so the banner and the hidden balance block can never disagree
 * about who the viewer is. Unanswered, the standing stays unknown — the
 * viewer's own balance then decides nothing.
 */
export function useWorkspaceOwnerStanding(
  options: { refreshInterval?: number } = {}
) {
  const credentials = useSessionCredentials();
  const { appToken, kubeconfig } = credentials;
  return useSWR(
    credentials.ready ? SESSION_SWR_KEYS.workspaceOwner(credentials) : null,
    () => loadWorkspaceOwnerStanding({ appToken, kubeconfig }),
    {
      refreshInterval: options.refreshInterval,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
}
