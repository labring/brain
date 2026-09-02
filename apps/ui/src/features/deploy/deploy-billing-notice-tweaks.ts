"use client";

import { type DevTweaksConfig, useDevTweaks } from "@workspace/dev-tweaks";

import {
  type DeployBillingNotice,
  type DeployBillingNoticeFacts,
  noticeFor,
} from "./deploy-billing-notice";

// The five forced forms, indexed the way a styling pass wants them — by
// card, not by billing scenario. Facts are forged and fed to the real
// judgment, so the forced card can never drift from shipped copy.
const FORCED_FACTS = {
  balance: {
    debtSuspended: true,
    full: null,
    paymentDue: false,
    payg: true,
    planCeiling: null,
    subscriptionPaused: false,
  },
  "payment-due-renew": {
    debtSuspended: false,
    full: null,
    paymentDue: "renew",
    payg: false,
    planCeiling: null,
    subscriptionPaused: false,
  },
  "payment-due-resubscribe": {
    debtSuspended: false,
    full: null,
    paymentDue: "resubscribe",
    payg: false,
    planCeiling: null,
    subscriptionPaused: false,
  },
  paused: {
    debtSuspended: false,
    full: null,
    paymentDue: false,
    payg: false,
    planCeiling: null,
    subscriptionPaused: true,
  },
  // Subscribed below the ceiling: the quota card's fullest form — the
  // plan-first primary CTA beside the quiet View usage.
  quota: {
    debtSuspended: false,
    full: { label: "CPU", percentUsed: 100, type: "cpu" },
    paymentDue: false,
    payg: false,
    planCeiling: false,
    subscriptionPaused: false,
  },
} satisfies Record<string, DeployBillingNoticeFacts>;

const DEPLOY_BILLING_NOTICE_TWEAKS = {
  force: {
    default: "off",
    options: ["off", ...Object.keys(FORCED_FACTS)],
    type: "select",
  },
} satisfies DevTweaksConfig;

// Same build gate as the panel itself (dev-tweaks.tsx): the knob may only
// ever act where the panel that flips it can exist.
const TWEAKABLE_BUILD =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_TWEAKS === "1";

/** The card one select option forces; null for "off" or an unknown value. */
export function forcedDeployBillingNotice(
  option: string
): DeployBillingNotice | null {
  if (!Object.hasOwn(FORCED_FACTS, option)) {
    return null;
  }
  return noticeFor(FORCED_FACTS[option as keyof typeof FORCED_FACTS]);
}

/**
 * Styling override for the pane's notice slot: while the select names a
 * card, every deployment pane renders it regardless of the real judgment.
 * A tweak, not a Dev Mock, and deliberately pane-only — the status hint
 * banner, the chat wall, and the field-level quota warnings keep their real
 * state, so ADR-0070's judgment is only ever overridden where the dev
 * tweaks panel exists. The section appears once a deployment pane mounts.
 */
export function useDeployBillingNoticeForce(): DeployBillingNotice | null {
  const values = useDevTweaks(
    "Deploy · billing notice",
    DEPLOY_BILLING_NOTICE_TWEAKS,
    { id: "deploy-billing-notice", persist: { storage: "sessionStorage" } }
  );
  if (!TWEAKABLE_BUILD) {
    return null;
  }
  return forcedDeployBillingNotice(values.force);
}
