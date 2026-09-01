import { quotaResourceNoun } from "@/features/billing/billing-usage-data";

import { deployBillingEvidence } from "./task/failure-details";
import type { DeployTaskFailureDetails } from "./task/schema";

/**
 * The billing callout under a failed Deployment Timeline Step (design spec
 * §5.4, AIM-325 variant B): when the terminal failure was the platform's
 * money or quota wall, the step says so and offers the fix. Task lifecycle
 * stays in the pane footer — Redeploy exists once. Pure presentation.
 */
export interface DeploymentBillingInterruption {
  body: string;
  cta: { href: string; label: string };
  icon: "alert" | "wallet";
  title: string;
}

export function deploymentBillingInterruption(
  details: Pick<DeployTaskFailureDetails, "billingEvidence" | "reason"> | null
): DeploymentBillingInterruption | null {
  if (details == null) {
    return null;
  }
  if (details.reason === "balance-exhausted") {
    return {
      body: "Your account balance ran out while this deployment was running, and pay-as-you-go workspaces are suspended. Top up to lift the suspension, then redeploy.",
      cta: { href: "/billing", label: "Top up balance" },
      icon: "wallet",
      title: "Account balance exhausted",
    };
  }
  if (details.reason === "subscription-expired") {
    // Voice stays plan-neutral: an expired Free plan must not be asked to
    // renew (CONTEXT.md, Workspace Subscription Renewal), and the evidence
    // does not carry the plan.
    return {
      body: "The workspace's subscription expired, so the workspace is suspended and this deployment stopped. Restore a plan, then redeploy.",
      cta: { href: "/billing", label: "View plan" },
      icon: "alert",
      title: "Subscription expired",
    };
  }
  if (details.reason === "quota-exceeded") {
    const evidence = deployBillingEvidence(details.billingEvidence);
    const label = evidence?.kind === "quota-full" ? evidence.label : null;
    return {
      body:
        label == null
          ? "This workspace doesn't have enough quota to finish the deployment. Free resources or upgrade the plan, then redeploy."
          : `This workspace doesn't have enough ${quotaResourceNoun(label)} quota to finish the deployment. Free resources or upgrade the plan, then redeploy.`,
      cta: { href: "/billing/usage", label: "View usage" },
      icon: "alert",
      title:
        label == null ? "Resource quota is full" : `${label} quota is full`,
    };
  }
  return null;
}
