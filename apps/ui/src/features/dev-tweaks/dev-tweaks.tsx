"use client";

import dynamic from "next/dynamic";

const DevTweaksPane = dynamic(
  () => import("./dev-tweaks-pane").then((mod) => mod.DevTweaksPane),
  { ssr: false }
);

/** Mounts the dev tweaks pane (⌃⌥T) in development builds only. */
export function DevTweaks() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  return <DevTweaksPane />;
}
