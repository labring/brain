"use client";

import "@workspace/dev-tweaks/styles.css";

import {
  DevTweaksIndicator,
  DevTweaksPanel,
  DevTweaksProvider,
} from "@workspace/dev-tweaks";
import type { CSSProperties, ReactNode } from "react";

/**
 * Host bridge: the panel skin is self-owned (`--dtp-*`, always dark), but the
 * fonts and the frame card's surface come from the host so the docked page
 * keeps its real look.
 */
const HOST_BRIDGE_STYLE: CSSProperties = {
  "--dtp-card-bg": "var(--background)",
  "--dtp-card-ring": "var(--border)",
  "--dtp-font-mono": "var(--font-mono)",
  "--dtp-font-sans": "var(--font-sans)",
} as CSSProperties;

const DEMO_BUILD = process.env.NEXT_PUBLIC_DEV_TWEAKS === "1";

/**
 * Dev-only composition root. Mock persistence drivers register here when a
 * feature needs one (e.g. the billing cookie driver once costcenter lands);
 * the panel itself stays feature-agnostic.
 */
export function DevTweaksEnabled({ children }: { children: ReactNode }) {
  return (
    <DevTweaksProvider>
      <DevTweaksPanel style={HOST_BRIDGE_STYLE}>{children}</DevTweaksPanel>
      {/* In demo builds the capsule is the only entry to the panel, so it
          stays present even with nothing active. */}
      <DevTweaksIndicator
        alwaysVisible={DEMO_BUILD}
        style={HOST_BRIDGE_STYLE}
      />
    </DevTweaksProvider>
  );
}
