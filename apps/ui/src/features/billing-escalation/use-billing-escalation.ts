"use client";

import { useCallback, useMemo } from "react";

import { useNotificationFeed } from "@/features/notifications/use-notification-feed";
import { accountDebtHolds } from "@/features/status-hint/status-hint-model";
import { useStatusHintInputs } from "@/features/status-hint/use-status-hint-inputs";

import {
  type BillingEscalationStage,
  billingEscalationDismissalTargets,
  billingEscalationStage,
  selectBillingEscalation,
} from "./billing-escalation-model";
import { useBillingEscalationForce } from "./billing-escalation-tweaks";

export interface BillingEscalationSlot {
  /**
   * Closes the dialog the only way it closes: by marking the announced stage
   * and its superseded set read through the feed's dispatch. The receipt is
   * optimistic, so the dialog closes at once and does not reopen on the next
   * poll; a failed receipt rolls back like the inbox's does, and the dialog
   * may then return. Inert while the dev-tweaks knob forces the dialog.
   */
  dismiss: () => void;
  /** The stage to announce, or null while nothing new is unread. */
  stage: BillingEscalationStage | null;
}

function noop(): void {
  // The forced preview writes nothing.
}

/**
 * The Billing Escalation Dialog's contents, re-evaluated on every feed
 * update: the merged Notification feed the inbox already polls (no new
 * poll), the session's optimistic reads, and the Account Debt verdict the
 * Status Hint and the Deploy Billing Notice share. It opens on entry when
 * the first feed answer yields a candidate and mid-session whenever a later
 * poll yields a new one; it never opens for a stage the viewer just
 * dismissed, because the dismissal writes the read id first.
 */
export function useBillingEscalation(): BillingEscalationSlot {
  const feed = useNotificationFeed();
  const inputs = useStatusHintInputs();
  const { subscription } = inputs;
  const accountDebt = useMemo(() => accountDebtHolds(inputs), [inputs]);
  const selection = useMemo(
    () =>
      selectBillingEscalation({
        accountDebt,
        items: feed.items,
        readIds: feed.readIds,
      }),
    [accountDebt, feed.items, feed.readIds]
  );
  const context = useMemo(() => ({ subscription }), [subscription]);
  const stage = useMemo(
    () =>
      selection == null
        ? null
        : billingEscalationStage(selection.announced, context),
    [context, selection]
  );
  const { markManyRead } = feed;
  const dismiss = useCallback(() => {
    if (selection != null) {
      markManyRead(billingEscalationDismissalTargets(selection));
    }
  }, [markManyRead, selection]);

  const forced = useBillingEscalationForce(context);
  if (forced != null) {
    return { dismiss: noop, stage: forced };
  }
  return { dismiss, stage };
}
