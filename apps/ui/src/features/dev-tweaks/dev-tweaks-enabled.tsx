"use client";

import "@workspace/dev-tweaks/styles.css";

import {
  DevTweaksIndicator,
  DevTweaksPanel,
  DevTweaksProvider,
} from "@workspace/dev-tweaks";
import type { CSSProperties, ReactNode } from "react";

import {
  BILLING_DEV_MOCK_GROUP_KEY,
  billingDevMockDriver,
} from "@/features/billing/billing-dev-mock";

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
 * Feature-owned persistence drivers, addressed from group defs by name. The
 * panel itself stays feature-agnostic — this composition root is the only
 * place dev-tweaks meets a feature.
 */
const DRIVERS = {
  [BILLING_DEV_MOCK_GROUP_KEY]: billingDevMockDriver,
};

/** Dev-only composition root. */
export function DevTweaksEnabled({ children }: { children: ReactNode }) {
  return (
    <DevTweaksProvider drivers={DRIVERS}>
      <DevTweaksPanel style={HOST_BRIDGE_STYLE}>{children}</DevTweaksPanel>
      {/* The capsule is a dirty indicator only: hidden until an override is
          active, in demo builds and local dev alike. The panel opens with
          ⌃⌥T. */}
      <DevTweaksIndicator style={HOST_BRIDGE_STYLE} />
    </DevTweaksProvider>
  );
}
