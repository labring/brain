"use client";

import dynamic from "next/dynamic";

// Same inlined gate as dev-tweaks.tsx: a real production build statically
// drops the dynamic import and tree-shakes the mock module away;
// `NEXT_PUBLIC_DEV_TWEAKS=1` keeps it for demo deployments.
const DeployTaskDevMockTweaks =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_TWEAKS === "1"
    ? dynamic(() =>
        import("./dev-mock").then((mod) => mod.DeployTaskDevMockTweaks)
      )
    : null;

/** Mounts the deployment task mock's dev-tweaks registration on /project. */
export function DeployTaskDevMockGate() {
  if (!DeployTaskDevMockTweaks) {
    return null;
  }
  return <DeployTaskDevMockTweaks />;
}
