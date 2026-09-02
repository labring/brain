"use client";

import { useMemo } from "react";

import type { BillingQuotaType } from "@/features/billing/billing-usage-data";
import { useStatusHintInputs } from "@/features/status-hint/use-status-hint-inputs";

import {
  type DeployBillingNotice,
  resolveDeployBillingNotice,
} from "./deploy-billing-notice";
import { useDeployBillingNoticeForce } from "./deploy-billing-notice-tweaks";

/**
 * The pre-deploy notice for the current workspace, judged from the same
 * reads the status hint evaluates (ADR-0070). Null while the facts are
 * still unknown — a notice is never guessed. `paneConsumes` names quota
 * types this pane's every deploy request includes, which then doom like the
 * universal cpu/memory/pod set.
 */
export function useDeployBillingNotice(
  options: { paneConsumes?: readonly BillingQuotaType[] } = {}
): DeployBillingNotice | null {
  const forced = useDeployBillingNoticeForce();
  const inputs = useStatusHintInputs();
  const { paneConsumes } = options;
  const judged = useMemo(
    () => resolveDeployBillingNotice(inputs, { paneConsumes }),
    [inputs, paneConsumes]
  );
  return forced ?? judged;
}

/**
 * Whether one quota type sits at its ceiling — for field-level warnings on
 * the request-scoped quotas (storage, nodeport) the notice deliberately
 * does not voice (ADR-0070).
 */
export function useQuotaTypeFull(type: BillingQuotaType): boolean {
  const inputs = useStatusHintInputs();
  return useMemo(
    () =>
      inputs.quota?.some(
        (row) => row.type === type && row.percentUsed >= 100
      ) === true,
    [inputs, type]
  );
}
