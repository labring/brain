"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import { CircleCheck } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { formatBillingAmount } from "@/features/billing/billing-amount";
import { formatBillingDate } from "@/features/billing/billing-datetime";
import {
  PLAN_CHECK_STROKE,
  PlanCheckGradientDefs,
  planCardRecipe,
} from "@/features/billing/billing-plan-card";
import type { SettledPayment } from "@/features/billing/billing-plan-checkout-dialog";
import type { BillingPlanSnapshot } from "@/features/billing/billing-plan-data";
import type { BillingCurrency } from "@/features/billing/config-core";

/**
 * What a settled payment concluded: a plan change on the current Workspace,
 * or Workspace Creation's first subscription — the Stripe return of a
 * Workspace this tab created (spec §G.5), worded as such.
 */
export type SettledPaymentConclusion = "changed" | "created";

/**
 * Holds the conclusion both checkout surfaces show, so the wiring between a
 * settled payment and the congratulations dialog exists once. The refresh
 * hands over the snapshot it produced; the success callback opens the dialog
 * on it. A refresh that produced nothing leaves the checkout to close
 * silently rather than concluding on stale numbers.
 */
export function useSettledPaymentCongratulations() {
  const [congratulations, setCongratulations] = useState<
    | (SettledPayment & {
        conclusion: SettledPaymentConclusion;
        snapshot: BillingPlanSnapshot;
      })
    | null
  >(null);
  const settledSnapshotRef = useRef<BillingPlanSnapshot | null>(null);

  const open = useCallback(
    (
      snapshot: BillingPlanSnapshot,
      chargedMicroUnits: number | null,
      conclusion: SettledPaymentConclusion = "changed"
    ) => {
      setCongratulations({ chargedMicroUnits, conclusion, snapshot });
    },
    []
  );

  return {
    chargedMicroUnits: congratulations?.chargedMicroUnits ?? null,
    conclusion: congratulations?.conclusion ?? "changed",
    dismiss: useCallback(() => setCongratulations(null), []),
    onPaymentSuccess: useCallback(
      ({ chargedMicroUnits }: SettledPayment) => {
        const settled = settledSnapshotRef.current;
        if (settled != null) {
          open(settled, chargedMicroUnits);
        }
      },
      [open]
    ),
    open,
    recordSettledSnapshot: useCallback(
      (snapshot: BillingPlanSnapshot | null) => {
        settledSnapshotRef.current = snapshot;
      },
      []
    ),
    snapshot: congratulations?.snapshot ?? null,
  };
}

interface BillingPlanCongratulationsDialogProps {
  /** See `SettledPayment`. A `null` amount drops the charged-today row. */
  chargedMicroUnits?: number | null;
  conclusion?: SettledPaymentConclusion;
  currency: BillingCurrency;
  onClose: () => void;
  /** The refreshed subscription. `null` keeps the dialog closed. */
  snapshot: BillingPlanSnapshot | null;
  /**
   * The Workspace's display name, for a creation's conclusion; the
   * subscription itself only knows the namespace.
   */
  workspaceName?: string | null;
}

/**
 * The conclusion of a paid plan change, mounted by both the Plan view and the
 * Pricing view so the entry point never changes the ending. Built around the
 * plan's tier identity — the same gradient the order summary carried — with
 * the resources the workspace now has and a ledger separating today's
 * prorated charge from the recurring monthly amount.
 */
export function BillingPlanCongratulationsDialog({
  chargedMicroUnits = null,
  conclusion = "changed",
  currency,
  onClose,
  snapshot,
  workspaceName = null,
}: BillingPlanCongratulationsDialogProps) {
  const current = snapshot?.current ?? null;
  const recipe = current == null ? null : planCardRecipe(current.planName);

  return (
    <AppDialog.Root
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      open={snapshot != null}
    >
      <AppDialog.Content className="data-[size=default]:sm:max-w-md">
        {current == null ? null : (
          <>
            <PlanCheckGradientDefs />
            <div
              className={cn(
                "flex shrink-0 flex-col gap-1.5 border-border border-b p-6",
                recipe == null
                  ? "bg-input/30"
                  : cn("bg-linear-to-br", recipe.wash)
              )}
            >
              {conclusion === "created" ? (
                <p className="font-semibold text-muted-foreground text-xs uppercase tracking-widest">
                  Workspace created
                </p>
              ) : null}
              <AppDialog.Title
                className={cn(
                  "h-auto font-semibold text-4xl/11 tracking-tight",
                  recipe == null ? "text-foreground" : recipe.text
                )}
              >
                {current.planName}
              </AppDialog.Title>
              <AppDialog.Description>
                {conclusion === "created" && workspaceName
                  ? workspaceName
                  : current.workspace}
              </AppDialog.Description>
            </div>

            <AppDialog.Body className="gap-3.5 px-6 pt-5 pb-6">
              <p className="font-semibold text-muted-foreground text-xs uppercase tracking-widest">
                What this workspace now has
              </p>
              <div className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
                {current.resources.map((resource) => (
                  <div
                    className="flex min-w-0 items-center gap-2"
                    key={resource.label}
                  >
                    <CircleCheck
                      aria-hidden
                      className={cn("size-4 shrink-0", PLAN_CHECK_STROKE)}
                      strokeWidth={1.75}
                    />
                    <span className="min-w-0 truncate text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {resource.value}
                      </span>{" "}
                      {resource.label}
                    </span>
                  </div>
                ))}
              </div>
              <Separator />
              {/* Today's prorated charge is the number that left the card;
                  the monthly amount is next cycle's business. */}
              <dl className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-1.5">
                {chargedMicroUnits == null ? null : (
                  <>
                    <dt className="text-muted-foreground">Charged today</dt>
                    <dd className="font-semibold tabular-nums">
                      {formatBillingAmount(chargedMicroUnits, currency)}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">
                  Billed monthly from{" "}
                  {formatBillingDate(current.currentPeriodEndAt)}
                </dt>
                <dd className="font-medium tabular-nums">
                  {formatBillingAmount(current.priceMicroUnits, currency)}
                </dd>
              </dl>
              <AppButton className="mt-0.5 w-full" onClick={onClose}>
                Done
              </AppButton>
            </AppDialog.Body>
          </>
        )}
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

export type { BillingPlanCongratulationsDialogProps };
