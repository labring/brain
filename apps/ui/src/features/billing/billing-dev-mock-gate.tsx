"use client";

import dynamic from "next/dynamic";

// Same inlined gate as dev-tweaks.tsx: a real production build statically
// drops the dynamic import and tree-shakes the mock module away.
const BillingDevMockTweaks =
  process.env.NODE_ENV === "development"
    ? dynamic(() =>
        import("./billing-dev-mock").then((mod) => mod.BillingDevMockTweaks)
      )
    : null;

/** Mounts the billing mock's dev-tweaks registration on /billing screens. */
export function BillingDevMockGate() {
  if (!BillingDevMockTweaks) {
    return null;
  }
  return <BillingDevMockTweaks />;
}
