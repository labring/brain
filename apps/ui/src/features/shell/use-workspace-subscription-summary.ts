"use client";

import { kubeconfigCredentialKey } from "@workspace/api/credential-key";
import { useAtomValue } from "jotai";
import useSWR from "swr";

import { loadWorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

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
  const appToken = useAtomValue(appTokenAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const workspace = useAtomValue(namespaceAtom).trim();
  const credentialsReady =
    appToken !== "" && kubeconfig !== "" && workspace !== "";

  // Live billing data, not the login-time session snapshot: the badge and
  // hint follow the same subscription route as the Billing Area's hooks.
  return useSWR(
    credentialsReady
      ? ([
          "app-sidebar-subscription",
          workspace,
          kubeconfigCredentialKey(kubeconfig),
          appToken,
        ] as const)
      : null,
    () => loadWorkspaceSubscriptionSummary({ appToken, kubeconfig, workspace }),
    {
      refreshInterval: options.refreshInterval,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
}
