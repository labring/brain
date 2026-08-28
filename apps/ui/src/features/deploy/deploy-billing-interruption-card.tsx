"use client";

import { TriangleAlert, Wallet } from "lucide-react";

import {
  BillingCalloutCard,
  BillingCalloutLink,
} from "@/features/billing/billing-callout-card";

import type { DeploymentBillingInterruption } from "./deploy-billing-interruption";

/**
 * The billing callout under a failed Deployment Timeline Step (design spec
 * §5.4, AIM-325 variant B): headline, explanation, and the billing CTA.
 * Task lifecycle (Cancel / Redeploy) stays in the pane footer — Redeploy
 * exists once, as the retry after a top-up and the escape from a misjudged
 * classification.
 */
export function DeploymentBillingInterruptionCard({
  interruption,
}: {
  interruption: DeploymentBillingInterruption;
}) {
  return (
    <BillingCalloutCard
      action={<BillingCalloutLink cta={interruption.cta} />}
      body={interruption.body}
      data-slot="deployment-billing-interruption"
      icon={interruption.icon === "wallet" ? Wallet : TriangleAlert}
      title={interruption.title}
    />
  );
}
