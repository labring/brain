"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { TriangleAlert, Wallet } from "lucide-react";
import Link from "next/link";

import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";

import type { DeployBillingWall } from "./deploy-billing-wall";

/**
 * The blocking card a deployment pane shows in place of its form while the
 * pre-deploy wall holds (design spec rows E1/E2): the billing callout
 * family's destructive container, one CTA to the fix. Deliberately not
 * dismissible — the wall is a fact that will certainly fail the deploy.
 */
export function DeployBillingWallCard({ wall }: { wall: DeployBillingWall }) {
  const Icon = wall.kind === "balance" ? Wallet : TriangleAlert;
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4"
      data-slot="deploy-billing-wall-card"
      data-wall={wall.kind}
      role="alert"
    >
      <div className="flex items-start gap-2.5">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium text-foreground text-sm leading-5">
            {wall.title}
          </p>
          <p className="text-muted-foreground text-xs leading-4">{wall.body}</p>
        </div>
      </div>
      <AppButton
        className="self-start"
        nativeButton={false}
        render={
          <Link href={wall.cta.href} onClick={recordBillingReturnRoute}>
            {wall.cta.label}
          </Link>
        }
        size="sm"
      />
    </div>
  );
}
