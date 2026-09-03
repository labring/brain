"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { useSetAtom } from "jotai";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Fragment, useLayoutEffect, useState } from "react";

import type { BillingCta } from "@/features/billing/billing-cta";
import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import { BILLING_TONE_TEXT } from "@/features/billing/billing-surface-tones";
import { useResolvedBillingCta } from "@/features/billing/use-billing-cta";

import type { BillingEscalationStage } from "./billing-escalation-model";
import { billingEscalationOpenAtom } from "./billing-escalation-store";
import { useBillingEscalation } from "./use-billing-escalation";

/**
 * The Billing Escalation Dialog (CONTEXT.md, Notifications): the one dialog
 * that announces a step up the platform's debt ladder. An event, not a
 * state — the Status Hint keeps carrying the state beside it — so it never
 * blocks: Dismiss, the fix, Esc and the backdrop all close it, and nothing
 * on the page is disabled while it is up.
 */

/**
 * The fix, primary because it is the point of the dialog: a Desktop-resolved
 * top-up leaves in a new tab; everything else hops into the Billing Area
 * with the return route recorded. Both navigate and dismiss.
 */
function BillingEscalationFix({
  cta,
  onDismiss,
}: {
  cta: BillingCta;
  onDismiss: () => void;
}) {
  const resolved = useResolvedBillingCta(cta);
  if (resolved.external) {
    return (
      <AppButton
        nativeButton={false}
        render={
          <a
            href={resolved.href}
            onClick={onDismiss}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden data-icon="inline-start" />
            {resolved.label}
          </a>
        }
        variant="primary"
      />
    );
  }
  return (
    <AppButton
      nativeButton={false}
      render={
        <Link
          href={resolved.href}
          onClick={() => {
            recordBillingReturnRoute();
            onDismiss();
          }}
        >
          {resolved.label}
        </Link>
      }
      variant="primary"
    />
  );
}

export function BillingEscalationDialogView({
  onDismiss,
  open,
  stage,
}: {
  /** Fired exactly once per close, whatever closed it. */
  onDismiss: () => void;
  open: boolean;
  stage: BillingEscalationStage;
}) {
  return (
    <AppDialog.Root
      onOpenChange={(next) => {
        if (!next) {
          onDismiss();
        }
      }}
      open={open}
    >
      <AppDialog.Content data-ladder={stage.ladder}>
        <AppDialog.Header>
          {/* The destructive billing tone sits on icon and title only; the
              body keeps the dialog's muted default. */}
          <AppDialog.WarningIcon className={BILLING_TONE_TEXT.destructive} />
          <AppDialog.Title className={BILLING_TONE_TEXT.destructive}>
            {stage.title}
          </AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            {stage.body.map((segment) =>
              segment.emphasis ? (
                // The deadline is the first thing to see: the cancel-plan
                // dialog's convention for a date inside a muted sentence.
                <span
                  className="font-medium text-foreground"
                  key={`date:${segment.text}`}
                >
                  {segment.text}
                </span>
              ) : (
                <Fragment key={`text:${segment.text}`}>{segment.text}</Fragment>
              )
            )}
          </AppDialog.Description>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel>Dismiss</AppDialog.Cancel>
          <BillingEscalationFix cta={stage.fix} onDismiss={onDismiss} />
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

/**
 * The connected dialog, mounted beside the Status Hint in every app shell
 * (project and Billing Area alike). Open while the model names a stage;
 * closing marks it read, so read state is the only memory. Publishes its
 * open state for the Onboarding Gate, whose sampling dialog waits for it.
 */
export function BillingEscalationDialog() {
  const { dismiss, stage } = useBillingEscalation();
  const setEscalationOpen = useSetAtom(billingEscalationOpenAtom);
  const open = stage != null;

  // The exit animation still needs its words after the selection has gone:
  // the last announced stage stays rendered until the next one replaces it.
  const [shown, setShown] = useState(stage);
  if (stage != null && stage !== shown) {
    setShown(stage);
  }

  // Published before paint, so a sampling dialog that would open in the
  // same commit is held back rather than flashed and snapped shut.
  useLayoutEffect(() => {
    setEscalationOpen(open);
    return () => {
      setEscalationOpen(false);
    };
  }, [open, setEscalationOpen]);

  if (shown == null) {
    return null;
  }
  return (
    <BillingEscalationDialogView
      onDismiss={dismiss}
      open={open}
      stage={shown}
    />
  );
}
