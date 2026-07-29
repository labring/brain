"use client";

import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { appTokenAtom } from "@/lib/auth-store";
import { createDeploymentTargetClientAdapters } from "./client-adapters";
import type { DeploymentTargetPipelineAdapters } from "./pipeline";

/**
 * Deploy-task creation adapters with the App Token hydrated from the auth
 * store (ADR-0059); callers supply the workspace credentials they already
 * hold.
 */
export function useDeploymentTargetAdapters(input: {
  kubeconfig: string;
  namespace: string;
}): DeploymentTargetPipelineAdapters {
  const appToken = useAtomValue(appTokenAtom);
  const { kubeconfig, namespace } = input;
  return useMemo(
    () =>
      createDeploymentTargetClientAdapters({ appToken, kubeconfig, namespace }),
    [appToken, kubeconfig, namespace]
  );
}
