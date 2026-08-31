import {
  firstFullQuotaRow,
  type QuotaFullnessRow,
  quotaResourceNoun,
} from "@/features/billing/billing-usage-data";
import {
  debtSuspendsWorkspace,
  type WorkspaceBillingStanding,
} from "@/features/billing/server/billing-standing-core";
import {
  accountDebtHolds,
  type StatusHintInputs,
} from "@/features/status-hint/status-hint-model";

/**
 * The pre-deploy wall (design spec rows E1/E2): a deployment entry is
 * blocked while a fact that will certainly fail it already holds — Account
 * Debt on a Pay-As-You-Go workspace (the platform suspends only those at
 * ≤ 0; a subscribed workspace's resources ride its plan) or a deployable
 * quota at 100%. It is the same judgment the status hint makes from the
 * same reads; a low-but-positive balance never walls ("中途跑穿" is not
 * predictable, so it is not pre-empted). Pure.
 */
export interface DeployBillingWall {
  body: string;
  cta: { href: string; label: string };
  kind: "balance" | "quota";
  title: string;
}

function wallFor(
  debtSuspended: boolean | null,
  full: QuotaFullnessRow | null
): DeployBillingWall | null {
  if (debtSuspended === true) {
    return {
      body: "Pay-as-you-go workspaces are suspended, so new deployments can't start. Top up your balance to restore them.",
      cta: { href: "/billing", label: "Top up balance" },
      kind: "balance",
      title: "Account balance in debt",
    };
  }
  if (full == null) {
    return null;
  }
  return {
    body: `New deployments can't start until ${quotaResourceNoun(full.label)} is freed or the plan is upgraded.`,
    cta: { href: "/billing/usage", label: "View usage" },
    kind: "quota",
    title: `${full.label} quota is full`,
  };
}

/**
 * The wall as the panes judge it, from the status hint's client-side
 * inputs. `accountDebtHolds` is already narrowed to the workspace the
 * platform would actually suspend (unknown subscription fails open), so the
 * banner and the wall are literally the same predicate.
 */
export function resolveDeployBillingWall(
  inputs: StatusHintInputs
): DeployBillingWall | null {
  return wallFor(
    accountDebtHolds(inputs),
    inputs.quota == null ? null : firstFullQuotaRow(inputs.quota)
  );
}

/**
 * The same wall as the server judges it, for deploy entries that never
 * render a pane — the assistant's deploy tool.
 */
export function deployBillingWallFromStanding(
  standing: WorkspaceBillingStanding
): DeployBillingWall | null {
  return wallFor(debtSuspendsWorkspace(standing), standing.fullQuota);
}
