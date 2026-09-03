import { TOP_UP_DESKTOP } from "@/features/billing/billing-cta";
import type { NotificationCTA } from "@/features/shell/app-sidebar-notifications-model";

/**
 * The display-layer override table for the platform's fixed-name debt-ladder
 * CRs (design spec §10 rule 2). Upstream English carries broken phrasing
 * ("Radical resource release") that must never reach users, so the eight
 * known names map to Brain-voiced title, body, and CTA. Pure display
 * substitution: the CR is the source of truth and is never touched; unknown
 * names fall back to the original text. English only — `i18ns.zh` is never
 * read.
 */

export interface CROverride {
  body: string;
  cta: NotificationCTA;
  title: string;
}

/**
 * Account money recovers by a Desktop top-up (CONTEXT.md, Account Debt);
 * the Plan view is only the fallback while the desktop link is unresolved.
 * Shared with the Billing Escalation Dialog's account-ladder fix.
 */
export const TOP_UP_BALANCE: NotificationCTA = {
  desktop: TOP_UP_DESKTOP,
  href: "/billing",
  label: "Top up balance",
};

/**
 * The pre-debt warning tiers are conversion touchpoints, not recovery: the
 * one CTA goes to the in-app plans (the body keeps the top-up path named).
 */
const VIEW_PLANS: NotificationCTA = { href: "/billing", label: "View plans" };

/** A lapsed Workspace Subscription recovers by renewing on the Plan page. */
const RENEW_PLAN: NotificationCTA = { href: "/billing", label: "Renew plan" };

export const CR_OVERRIDES: Readonly<Record<string, CROverride>> = {
  "debt-choice-criticalbalanceperiod": {
    body: "Your balance is under $5. Pay-as-you-go workspaces are suspended at $0 — subscribe to a plan, or top up in Sealos Desktop.",
    cta: VIEW_PLANS,
    title: "Account balance almost empty",
  },
  "debt-choice-debtdeletionperiod": {
    body: "Your balance is still in debt. Resources will be deleted soon unless you top up.",
    cta: TOP_UP_BALANCE,
    title: "Account resources scheduled for deletion",
  },
  "debt-choice-debtperiod": {
    body: "Pay-as-you-go workspaces are suspended. Top up your balance to restore them.",
    cta: TOP_UP_BALANCE,
    title: "Account balance in debt",
  },
  "debt-choice-finaldeletionperiod": {
    body: "Your balance is still in debt. All resources under this account can be deleted at any time.",
    cta: TOP_UP_BALANCE,
    title: "Account resources face final deletion",
  },
  "debt-choice-lowbalanceperiod": {
    body: "Your balance is under $10. Pay-as-you-go workspaces suspend at $0 — subscribe to a plan, or top up in Sealos Desktop.",
    cta: VIEW_PLANS,
    title: "Account balance is low",
  },
  "workspace-debt-debt": {
    body: "The subscription has expired and this workspace is suspended. Renew to restore it.",
    cta: RENEW_PLAN,
    title: "Workspace suspended — payment due",
  },
  "workspace-debt-debtfinaldeletion": {
    body: "Resources can be permanently deleted at any time. This cannot be undone.",
    cta: RENEW_PLAN,
    title: "Workspace faces final deletion",
  },
  "workspace-debt-debtpredeletion": {
    body: "The subscription is still unpaid. Resources will be permanently deleted soon.",
    cta: RENEW_PLAN,
    title: "Workspace deletion approaching",
  },
};

/**
 * The low-balance warning tiers (catalog D1) the gift-only filter hides for
 * never-topped-up newcomers. The debt ladder (D2: `debtperiod` onward) is
 * never filtered — a suspended workspace must always be visible.
 */
export const GIFT_FILTERED_CR_NAMES: ReadonlySet<string> = new Set([
  "debt-choice-lowbalanceperiod",
  "debt-choice-criticalbalanceperiod",
]);
