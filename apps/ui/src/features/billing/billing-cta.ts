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
