"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Both halves of the gate are inlined at build time, so a real production
// build (no demo flag) statically drops the dynamic import and tree-shakes
// the whole panel away; `NEXT_PUBLIC_DEV_TWEAKS=1` opens the door for demo
// deployments.
const DevTweaksEnabled =
  process.env.NODE_ENV === "development" ||
  process.env.NEXT_PUBLIC_DEV_TWEAKS === "1"
    ? dynamic(() =>
        import("./dev-tweaks-enabled").then((mod) => mod.DevTweaksEnabled)
      )
    : null;

/**
 * Mounts the DialKit dev tweaks panel (floating popover) next to the app.
 * Inert in production: renders children untouched.
 */
export function DevTweaks({ children }: { children: ReactNode }) {
  if (!DevTweaksEnabled) {
    return <>{children}</>;
  }
  return <DevTweaksEnabled>{children}</DevTweaksEnabled>;
}
