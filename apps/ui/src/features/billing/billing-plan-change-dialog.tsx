"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { DialogClose } from "@workspace/ui/components/dialog";
import { X } from "lucide-react";
import { useMemo } from "react";

import type { BillingCredentials } from "@/features/billing/billing-data-client";
import {
  type BillingPlanChangeServices,
  BillingPlanCheckoutDialog,
  DEFAULT_PLAN_CHANGE_SERVICES,
  planOperator,
} from "@/features/billing/billing-plan-checkout-dialog";
import {
  type BillingPlanSnapshot,
  subscriptionLifecycleAllowsBillingActions,
} from "@/features/billing/billing-plan-data";
import { BillingPlanPicker } from "@/features/billing/billing-plan-picker";
import type { BillingCurrency } from "@/features/billing/config-core";

interface BillingPlanChangeDialogProps {
  credentials: BillingCredentials;
  currency: BillingCurrency;
  gpuEnabled: boolean;
  now?: () => number;
  onManageCard?: () => void;
  onOpenChange: (open: boolean) => void;
  onSelectedPlanChange?: (planId: string | null) => void;
  onSubscriptionChanged: () => Promise<void>;
  open: boolean;
  paymentTimeoutMs?: number;
  pollIntervalMs?: number;
  schedulePoll?: (callback: () => void, delay: number) => () => void;
  selectedPlanId: string | null;
  services?: BillingPlanChangeServices;
  snapshot: BillingPlanSnapshot;
}

/**
 * The Plan view's plan-change dialog: the Plan Picker as the root stage, with
 * plan checkout stacked over it as a nested dialog once a plan is selected.
 * (The Pricing view skips this dialog entirely — its plans area is the
 * picker, so it mounts `BillingPlanCheckoutDialog` directly.)
 */
export function BillingPlanChangeDialog({
  credentials,
  currency,
  gpuEnabled,
  now,
  onManageCard,
  onOpenChange,
  onSelectedPlanChange,
  onSubscriptionChanged,
  open,
  paymentTimeoutMs,
  pollIntervalMs,
  schedulePoll,
  selectedPlanId,
  services = DEFAULT_PLAN_CHANGE_SERVICES,
  snapshot,
}: BillingPlanChangeDialogProps) {
  const selectedPlan = useMemo(
    () => snapshot.plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [selectedPlanId, snapshot.plans]
  );
  const pendingUpgradePlanName = snapshot.pendingUpgrade?.planName ?? null;
  const selectedPlanIsPendingUpgradeTarget =
    pendingUpgradePlanName == null ||
    (selectedPlan?.name.trim().toLowerCase() ?? "") ===
      pendingUpgradePlanName.trim().toLowerCase();
  const inDebt = snapshot.current.lifecycle === "payment-due";
  const checkoutPlan =
    !selectedPlanIsPendingUpgradeTarget ||
    planOperator(selectedPlan, inDebt) == null
      ? null
      : selectedPlan;

  // Dismissing the checkout is the "back" gesture: clearing the selection
  // returns to the picker underneath. Without a selection channel the whole
  // dialog closes instead (mirrors the old Back button's fallback).
  const dismissSelection = () => {
    if (onSelectedPlanChange == null) {
      onOpenChange(false);
      return;
    }
    onSelectedPlanChange(null);
  };

  return (
    <AppDialog.Root onOpenChange={onOpenChange} open={open}>
      {/* Carries the Canvas Glow material (see CONTEXT.md), like the app
          cost drawer: content layers must stay below z-20. */}
      <AppDialog.Content className="canvas-glow-overlay" size="2xl">
        <div className="flex shrink-0 items-center gap-4 px-8 pt-7">
          <AppDialog.Title className="h-auto font-semibold text-2xl/8">
            Choose Your Workspace Plan
          </AppDialog.Title>
          <AppDialog.Description className="sr-only">
            Choose the plan that fits this workspace.
          </AppDialog.Description>
          <DialogClose
            aria-label="Close"
            className="-m-2 shrink-0 cursor-pointer rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-input/30 hover:text-foreground focus-visible:ring-[1px] focus-visible:ring-blue-400/50"
          >
            <X aria-hidden className="size-5" />
          </DialogClose>
        </div>
        <AppDialog.Body className="px-8 pt-6 pb-8">
          <BillingPlanPicker
            actionable={
              snapshot.current.canManage &&
              subscriptionLifecycleAllowsBillingActions(
                snapshot.current.lifecycle
              )
            }
            currency={currency}
            gpuEnabled={gpuEnabled}
            inDebt={inDebt}
            onOpenUrl={services.openCheckoutUrl}
            onSelectPlan={(planId) => onSelectedPlanChange?.(planId)}
            pendingDowngradePlanName={
              snapshot.pendingDowngrade?.planName ?? null
            }
            pendingUpgradePlanName={pendingUpgradePlanName}
            plans={snapshot.plans}
          />
        </AppDialog.Body>

        <BillingPlanCheckoutDialog
          credentials={credentials}
          currency={currency}
          gpuEnabled={gpuEnabled}
          nested
          now={now}
          onClose={() => onOpenChange(false)}
          onDismiss={dismissSelection}
          onManageCard={onManageCard}
          onSubscriptionChanged={onSubscriptionChanged}
          open={open && checkoutPlan != null}
          paymentTimeoutMs={paymentTimeoutMs}
          plan={checkoutPlan}
          pollIntervalMs={pollIntervalMs}
          schedulePoll={schedulePoll}
          services={services}
          snapshot={snapshot}
        />
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

export type { BillingPlanChangeServices } from "@/features/billing/billing-plan-checkout-dialog";
export type { BillingPlanChangeDialogProps };
