"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";

import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";

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
  const Icon = interruption.icon === "wallet" ? Wallet : TriangleAlert;
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
      data-slot="deployment-billing-interruption"
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-foreground text-sm leading-5">
            {interruption.title}
          </p>
          <p className="text-muted-foreground text-xs leading-4">
            {interruption.body}
          </p>
        </div>
      </div>
      <AppButton
        className="self-start"
        nativeButton={false}
        render={
          <Link href={interruption.cta.href} onClick={recordBillingReturnRoute}>
            {interruption.cta.label}
          </Link>
        }
        size="sm"
      />
    </div>
  );
}
