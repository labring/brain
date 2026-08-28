"use client";

import { useMemo } from "react";

import { useStatusHintInputs } from "@/features/status-hint/use-status-hint-inputs";

import {
  type DeployBillingWall,
  resolveDeployBillingWall,
} from "./deploy-billing-wall";

/**
 * The pre-deploy wall for the current workspace, judged from the same
 * reads the status hint evaluates (design spec rows E1/E2). Null while the
 * entry is open or the facts are still unknown — a wall is never guessed.
 */
export function useDeployBillingWall(): DeployBillingWall | null {
  const inputs = useStatusHintInputs();
  return useMemo(() => resolveDeployBillingWall(inputs), [inputs]);
}
