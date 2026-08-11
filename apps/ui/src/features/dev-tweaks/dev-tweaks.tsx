"use client";

import dynamic from "next/dynamic";

const DevTweaksPane = dynamic(
  () => import("./dev-tweaks-pane").then((mod) => mod.DevTweaksPane),
  { ssr: false }
);

const BillingDevMockBadge = dynamic(
  () => import("./billing-dev-mock").then((mod) => mod.BillingDevMockBadge),
  { ssr: false }
);

/**
 * Mounts the dev tweaks pane (⌃⌥T) and the billing-mock badge in development
 * builds only.
 */
export function DevTweaks() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  return (
    <>
      <DevTweaksPane />
      <BillingDevMockBadge />
    </>
  );
}
