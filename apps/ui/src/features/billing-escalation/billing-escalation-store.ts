import { atom } from "jotai";

/**
 * Whether a Billing Escalation Dialog is open right now — raised before its
 * first paint and held until its exit animation has finished — the one fact
 * the Onboarding Gate reads so its sampling dialog waits while money and
 * deletion are being announced, and never opens over a dialog still leaving
 * (CONTEXT.md, Onboarding Gate). Session-only UI state; the dialog holds no
 * memory of its own — read receipts are the only memory.
 */
export const billingEscalationOpenAtom = atom(false);
