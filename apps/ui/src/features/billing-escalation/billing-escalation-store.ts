import { atom } from "jotai";

/**
 * Whether a Billing Escalation Dialog is open right now — the one fact the
 * Onboarding Gate reads so its sampling dialog waits while money and
 * deletion are being announced (CONTEXT.md, Onboarding Gate). Session-only
 * UI state; the dialog holds no memory of its own — read receipts are the
 * only memory.
 */
export const billingEscalationOpenAtom = atom(false);
