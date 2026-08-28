"use client";

import { TriangleAlert, Wallet } from "lucide-react";

import {
  BillingCalloutCard,
  BillingCalloutLink,
} from "@/features/billing/billing-callout-card";

import type { DeployBillingWall } from "./deploy-billing-wall";

/**
 * The blocking card a deployment pane shows in place of its form while the
 * Deploy Billing Wall holds (design spec rows E1/E2): the billing callout
 * family's container, one CTA to the fix. Deliberately not dismissible — the
 * wall is a fact that will certainly fail the deploy.
 */
export function DeployBillingWallCard({ wall }: { wall: DeployBillingWall }) {
  return (
    <BillingCalloutCard
      action={<BillingCalloutLink cta={wall.cta} />}
      body={wall.body}
      data-slot="deploy-billing-wall-card"
      data-wall={wall.kind}
      icon={wall.kind === "balance" ? Wallet : TriangleAlert}
      title={wall.title}
    />
  );
}
