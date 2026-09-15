"use client";

import useSWR from "swr";

import { loadWorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import { SESSION_SWR_KEYS } from "@/features/session/swr-keys";
import { useSessionCredentials } from "@/features/session/use-session-credentials";

/**
 * The App Sidebar's shared read of the Workspace Subscription summary — the
 * account row's badge and hint, and the Notification Center's role check for
 * the best-effort CR read patch, and the status hint's state evaluation.
 * One SWR key, so every consumer shares the request; a consumer that needs
 * the state to clear on its own passes a `refreshInterval`.
 */
export function useWorkspaceSubscriptionSummary(
  options: { refreshInterval?: number } = {}
) {
  const credentials = useSessionCredentials();
  const { appToken, kubeconfig, namespace: workspace } = credentials;

  // Live billing data, not the login-time session snapshot: the badge and
  // hint follow the same subscription route as the Billing Area's hooks.
  return useSWR(
    credentials.ready
      ? SESSION_SWR_KEYS.appSidebarSubscription(credentials)
      : null,
    () => loadWorkspaceSubscriptionSummary({ appToken, kubeconfig, workspace }),
    {
      refreshInterval: options.refreshInterval,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
}
