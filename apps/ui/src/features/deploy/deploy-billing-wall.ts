import { firstFullQuotaRow } from "@/features/billing/billing-usage-data";
import {
  accountDebtHolds,
  type StatusHintInputs,
} from "@/features/status-hint/status-hint-model";

/**
 * The pre-deploy wall (design spec rows E1/E2): a deployment entry is
 * blocked while a fact that will certainly fail it already holds — Account
 * Debt (the platform suspends PAYG workspaces at ≤ 0) or a deployable quota
 * at 100%. It is the same judgment the status hint makes from the same
 * reads; a low-but-positive balance never walls ("中途跑穿" is not
 * predictable, so it is not pre-empted). Pure.
 */
export interface DeployBillingWall {
  body: string;
  cta: { href: string; label: string };
  kind: "balance" | "quota";
  title: string;
}

/** "CPU" keeps its initialism mid-sentence; the rest read as common nouns. */
function resourceNoun(label: string): string {
  return label === label.toUpperCase() ? label : label.toLowerCase();
}

export function resolveDeployBillingWall(
  inputs: StatusHintInputs
): DeployBillingWall | null {
  if (accountDebtHolds(inputs) === true) {
    return {
      body: "Pay-as-you-go workspaces are suspended, so new deployments can't start. Top up your balance to restore them.",
      cta: { href: "/billing", label: "Top up balance" },
      kind: "balance",
      title: "Account balance in debt",
    };
  }
  const full = inputs.quota == null ? null : firstFullQuotaRow(inputs.quota);
  if (full == null) {
    return null;
  }
  return {
    body: `New deployments can't start until ${resourceNoun(full.label)} is freed or the plan is upgraded.`,
    cta: { href: "/billing/usage", label: "View usage" },
    kind: "quota",
    title: `${full.label} quota is full`,
  };
}
