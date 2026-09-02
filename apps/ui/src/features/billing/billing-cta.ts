/**
 * A billing reminder's call to action. `href` is the in-app route; when
 * `desktop` names a Sealos Desktop app and its deep link resolves, the CTA
 * leaves the product for that app instead (top-up is not a Brain
 * capability — CONTEXT.md, Account Balance), falling back to `href` in
 * previews and while the host config is still loading. Pure data; the
 * resolution lives in `use-billing-cta`.
 */
export interface BillingCta {
  desktop?: { app: string; label: string };
  href: string;
  label: string;
}

/**
 * Account money recovers by a Desktop top-up, never a subscription action
 * (CONTEXT.md, Account Debt): every top-up CTA shares this target so no
 * reminder promises a top-up the landing page cannot offer.
 */
export const TOP_UP_DESKTOP = {
  app: "system-costcenter",
  label: "Top up in Sealos Desktop",
} as const;

/** Subscription facts the quota CTA forks on; null marks unknown. */
export interface QuotaCtaContext {
  payg: boolean | null;
  planCeiling: boolean | null;
}

/**
 * The one plan-first quota CTA pair (ADR-0070): every surface that voices a
 * full quota — deploy notice, status hint, failure interruption — renders
 * this, so they can never offer different ways out of the same state.
 */
export function quotaCtaFor(context: QuotaCtaContext): {
  cta: BillingCta;
  secondaryCta?: BillingCta;
} {
  // A confirmed plan ceiling has no plan to sell: usage is the only way out.
  if (context.planCeiling === true) {
    return { cta: { href: "/billing/usage", label: "View usage" } };
  }
  return {
    // A PAYG workspace subscribes rather than upgrades (CONTEXT.md,
    // Pay-As-You-Go): the label follows, the destination is the same picker.
    cta: {
      href: "/billing?mode=upgrade",
      label: context.payg === true ? "Subscribe" : "Upgrade plan",
    },
    secondaryCta: { href: "/billing/usage", label: "View usage" },
  };
}
