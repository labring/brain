"use client";

import dynamic from "next/dynamic";

// Same inlined gate as dev-tweaks.tsx: a real production build statically
// drops the dynamic import and tree-shakes the mock module away;
// `NEXT_PUBLIC_DEV_TWEAKS=1` keeps it for demo deployments.
const BillingDevMockTweaks =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_TWEAKS === "1"
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
