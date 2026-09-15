"use client";

import { useAtomValue } from "jotai";
import { useMemo } from "react";

import {
  appTokenAtom,
  kubeconfigAtom,
  namespaceAtom,
  regionalTokenAtom,
} from "@/lib/auth-store";

import type { SessionCredentials } from "./swr-keys";

/** The Brain Session's credentials as one trimmed record, plus readiness. */
export function useSessionCredentials(): SessionCredentials & {
  /** True once the three request credentials and the namespace are held. */
  ready: boolean;
} {
  const appToken = useAtomValue(appTokenAtom).trim();
  const kubeconfig = useAtomValue(kubeconfigAtom).trim();
  const namespace = useAtomValue(namespaceAtom).trim();
  const regionalToken = useAtomValue(regionalTokenAtom).trim();
  // One stable record per credential set, so consumers can hold it in
  // hook dependencies without re-running on every render.
  return useMemo(
    () => ({
      appToken,
      kubeconfig,
      namespace,
      ready: appToken !== "" && kubeconfig !== "" && namespace !== "",
      regionalToken,
    }),
    [appToken, kubeconfig, namespace, regionalToken]
  );
}
