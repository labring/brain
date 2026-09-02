import {
  type BillingCta,
  type QuotaCtaContext,
  quotaCtaFor,
  TOP_UP_DESKTOP,
} from "@/features/billing/billing-cta";
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
  cta: BillingCta;
  icon: "alert" | "wallet";
  /** The quiet second way out beside a plan-first quota CTA. */
  secondaryCta?: { href: string; label: string };
  title: string;
}

/** Subscription facts the quota CTA forks on; null marks unknown. */
export type DeploymentBillingInterruptionContext = Partial<QuotaCtaContext>;

/**
 * With the evidence's persisted recovery voice, the card keeps the Deploy
 * Billing Notice's headline and CTA — a run pressed through the notice
 * fails into the same words, and an expired Free plan is never asked to
 * renew (CONTEXT.md, Workspace Subscription Renewal). Evidence from before
 * the voice was persisted stays plan-neutral.
 */
function subscriptionExpiredInterruption(
  billingEvidence: DeployTaskFailureDetails["billingEvidence"]
): DeploymentBillingInterruption {
  const evidence = deployBillingEvidence(billingEvidence);
  const recovery =
    evidence?.kind === "subscription-expired"
      ? (evidence.recovery ?? null)
      : null;
  if (recovery == null) {
    return {
      body: "The workspace's subscription expired, so the workspace is suspended and this deployment stopped. Restore a plan, then redeploy.",
      cta: { href: "/billing", label: "View plan" },
      icon: "alert",
      title: "Subscription expired",
    };
  }
  const resubscribe = recovery === "resubscribe";
  return {
    body: resubscribe
      ? "The workspace's subscription expired, so the workspace is suspended and this deployment stopped. Upgrade to a paid plan, then redeploy."
      : "The workspace's subscription expired, so the workspace is suspended and this deployment stopped. Renew the plan, then redeploy.",
    cta: resubscribe
      ? { href: "/billing?mode=upgrade", label: "Upgrade plan" }
      : { href: "/billing", label: "Renew plan" },
    icon: "alert",
    title: "Workspace suspended — payment due",
  };
}

export function deploymentBillingInterruption(
  details: Pick<DeployTaskFailureDetails, "billingEvidence" | "reason"> | null,
  context: DeploymentBillingInterruptionContext = {}
): DeploymentBillingInterruption | null {
  if (details == null) {
    return null;
  }
  if (details.reason === "balance-exhausted") {
    return {
      body: "Your account balance ran out while this deployment was running, and pay-as-you-go workspaces are suspended. Top up to lift the suspension, then redeploy.",
      cta: {
        desktop: TOP_UP_DESKTOP,
        href: "/billing",
        label: "Top up balance",
      },
      icon: "wallet",
      title: "Account balance in debt",
    };
  }
  if (details.reason === "subscription-expired") {
    return subscriptionExpiredInterruption(details.billingEvidence);
  }
  // Born paused with no trial (ADR-0074): nothing expired, so the card
  // must not speak of expiry or renewal — the way out is the first plan.
  if (details.reason === "subscription-paused") {
    return {
      body: "This workspace was created without a free trial, so it is suspended and this deployment stopped. Subscribe to a plan, then redeploy.",
      cta: { href: "/billing?mode=upgrade", label: "Choose a plan" },
      icon: "alert",
      title: "Workspace suspended — no active plan",
    };
  }
  if (details.reason === "quota-exceeded") {
    const evidence = deployBillingEvidence(details.billingEvidence);
    const label = evidence?.kind === "quota-full" ? evidence.label : null;
    const body =
      label == null
        ? "This workspace doesn't have enough quota to finish the deployment. Free resources or upgrade the plan, then redeploy."
        : `This workspace doesn't have enough ${quotaResourceNoun(label)} quota to finish the deployment. Free resources or upgrade the plan, then redeploy.`;
    const title =
      label == null ? "Resource quota is full" : `${label} quota is full`;
    return {
      body,
      ...quotaCtaFor({
        payg: context.payg ?? null,
        planCeiling: context.planCeiling ?? null,
      }),
      icon: "alert",
      title,
    };
  }
  return null;
}
