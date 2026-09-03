"use client";

import { type DevTweaksConfig, useDevTweaks } from "@workspace/dev-tweaks";

import {
  type BillingEscalationStage,
  type BillingEscalationStageContext,
  billingEscalationStageForName,
} from "./billing-escalation-model";

/** Every critical rung of both ladders — the stages the dialog can announce. */
export const BILLING_ESCALATION_TWEAK_STAGES = [
  "debt-choice-debtperiod",
  "debt-choice-debtdeletionperiod",
  "debt-choice-finaldeletionperiod",
  "workspace-debt-debt",
  "workspace-debt-debtpredeletion",
  "workspace-debt-debtfinaldeletion",
] as const;

// While forced, the dialog stays up and every write is inert — it cannot be
// closed from inside; switching the knob off is the only exit. This protects
// the developer's real inbox: no read mark is ever written for a preview.
const BILLING_ESCALATION_TWEAKS = {
  forceOpen: false,
  stage: {
    default: BILLING_ESCALATION_TWEAK_STAGES[0],
    options: [...BILLING_ESCALATION_TWEAK_STAGES],
    type: "select",
  },
} satisfies DevTweaksConfig;

// Same build gate as the panel itself (dev-tweaks.tsx): the knob may only
// ever act where the panel that flips it can exist.
const TWEAKABLE_BUILD =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_TWEAKS === "1";

/**
 * Styling preview for the Billing Escalation Dialog: a force-open switch and
 * a stage picker, mirroring the onboarding sampling dialog's knob. The
 * forced stage builds from the override table with the real subscription
 * context, so it can never drift from shipped copy. Null while off.
 */
export function useBillingEscalationForce(
  context: BillingEscalationStageContext
): BillingEscalationStage | null {
  const values = useDevTweaks(
    "Billing · escalation dialog",
    BILLING_ESCALATION_TWEAKS,
    { id: "billing-escalation", persist: { storage: "sessionStorage" } }
  );
  if (!(TWEAKABLE_BUILD && values.forceOpen)) {
    return null;
  }
  return billingEscalationStageForName(values.stage, context);
}
