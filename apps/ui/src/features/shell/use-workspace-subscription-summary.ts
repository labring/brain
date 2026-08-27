"use client";

import { useAtomValue } from "jotai";
import useSWR from "swr";

import { loadWorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

/**
 * The App Sidebar's shared read of the Workspace Subscription summary — the
 * account row's badge and hint, and the Notification Center's role check for
 * the best-effort CR read patch. One SWR key, so both consumers share the
 * request.
 */
export function useWorkspaceSubscriptionSummary() {
  const appToken = useAtomValue(appTokenAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const workspace = useAtomValue(namespaceAtom).trim();
  const credentialsReady =
    appToken !== "" && kubeconfig !== "" && workspace !== "";

  // Live billing data, not the login-time session snapshot: the badge and
  // hint follow the same subscription route as the Billing Area's hooks.
  return useSWR(
    credentialsReady
      ? (["app-sidebar-subscription", workspace, kubeconfig, appToken] as const)
      : null,
    () => loadWorkspaceSubscriptionSummary({ appToken, kubeconfig, workspace }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );
}
