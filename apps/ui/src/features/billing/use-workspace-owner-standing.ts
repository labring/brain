"use client";

import { kubeconfigCredentialKey } from "@workspace/api/credential-key";
import { useAtomValue } from "jotai";
import useSWR from "swr";

import { appTokenAtom, kubeconfigAtom, namespaceAtom } from "@/lib/auth-store";

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
  const appToken = useAtomValue(appTokenAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const workspace = useAtomValue(namespaceAtom).trim();
  const credentialsReady =
    appToken !== "" && kubeconfig !== "" && workspace !== "";
  return useSWR(
    credentialsReady
      ? ([
          "workspace-owner",
          workspace,
          kubeconfigCredentialKey(kubeconfig),
          appToken,
        ] as const)
      : null,
    () => loadWorkspaceOwnerStanding({ appToken, kubeconfig }),
    {
      refreshInterval: options.refreshInterval,
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );
}
