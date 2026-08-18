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
 * fonts and the frame card's ring come from the host. The card surface needs
 * no bridge — frame mode docks the page by insetting `<body>` itself, so the
 * card already wears the app's own background.
 */
const HOST_BRIDGE_STYLE: CSSProperties = {
  "--dtp-card-ring": "var(--border)",
  "--dtp-font-mono": "var(--font-mono)",
  "--dtp-font-sans": "var(--font-sans)",
} as CSSProperties;

/**
 * Dev-only composition root. Mock persistence drivers register here when a
 * feature needs one (e.g. the billing cookie driver once costcenter lands);
 * the panel itself stays feature-agnostic.
 */
export function DevTweaksEnabled({ children }: { children: ReactNode }) {
  return (
    <DevTweaksProvider>
      <DevTweaksPanel style={HOST_BRIDGE_STYLE}>{children}</DevTweaksPanel>
      {/* The capsule is a dirty indicator only: hidden until an override is
          active, in demo builds and local dev alike. The panel opens with
          ⌃⌥T. */}
      <DevTweaksIndicator style={HOST_BRIDGE_STYLE} />
    </DevTweaksProvider>
  );
}
