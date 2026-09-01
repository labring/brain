"use client";

import { CalendarClock, TriangleAlert, Wallet } from "lucide-react";

import {
  BillingCalloutCard,
  BillingCalloutLink,
  type BillingCalloutTone,
} from "@/features/billing/billing-callout-card";

import type { DeployBillingNotice } from "./deploy-billing-notice";

const NOTICE_ICONS = {
  balance: Wallet,
  "payment-due": CalendarClock,
  quota: TriangleAlert,
} as const;

// The same state never wears two colors: tones mirror the status hint
// banner's — a suspension (debt, payment-due) is destructive, a full quota
// a caution (ADR-0069: the notice advises, it does not refuse).
const NOTICE_TONES: Record<DeployBillingNotice["kind"], BillingCalloutTone> = {
  balance: "destructive",
  "payment-due": "destructive",
  quota: "warning",
};

/**
 * The advisory card a deployment pane shows above its still-usable form
 * while the Deploy Billing Notice holds (ADR-0069): the billing callout
 * family's container, one CTA to the fix. Not dismissible, but not a block
 * either — the deploy action stays enabled, and a run pressed through a
 * correct notice fails at the platform and comes back explained.
 */
export function DeployBillingNoticeCard({
  notice,
}: {
  notice: DeployBillingNotice;
}) {
  return (
    <BillingCalloutCard
      action={<BillingCalloutLink cta={notice.cta} />}
      body={notice.body}
      data-notice={notice.kind}
      data-slot="deploy-billing-notice-card"
      icon={NOTICE_ICONS[notice.kind]}
      title={notice.title}
      tone={NOTICE_TONES[notice.kind]}
    />
  );
}
