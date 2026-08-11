"use client";

import dynamic from "next/dynamic";

const DevTweaksPane = dynamic(
  () => import("./dev-tweaks-pane").then((mod) => mod.DevTweaksPane),
  { ssr: false }
);

const BillingDevMockSection = dynamic(
  () =>
    import("@/features/billing/billing-dev-mock").then(
      (mod) => mod.BillingDevMockSection
    ),
  { ssr: false }
);

const BillingDevMockBadge = dynamic(
  () =>
    import("@/features/billing/billing-dev-mock").then(
      (mod) => mod.BillingDevMockBadge
    ),
  { ssr: false }
);

/**
 * Dev-only composition root: mounts the generic dev tweaks pane (⌃⌥T) and
 * composes feature-owned pieces into it — the billing mock section and its
 * always-on badge. Deliberately the only place dev-tweaks meets a feature;
 * the pane itself stays feature-agnostic.
 */
export function DevTweaks() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  return (
    <>
      <DevTweaksPane>
        <BillingDevMockSection />
      </DevTweaksPane>
      <BillingDevMockBadge />
    </>
  );
}
