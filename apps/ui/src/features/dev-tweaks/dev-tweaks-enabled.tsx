"use client";

import "@workspace/dev-tweaks/styles.css";

import { DialRoot } from "@workspace/dev-tweaks";
import type { ReactNode } from "react";

/**
 * Dev-only composition root: mounts the DialKit panel once for the whole app.
 * Panels register from `useDialKit` call sites and surface in the floating
 * bubble (bottom-left, where the old indicator capsule lived).
 * `productionEnabled` because demo builds (NEXT_PUBLIC_DEV_TWEAKS=1) run with
 * NODE_ENV=production — the dev/demo gate lives in dev-tweaks.tsx.
 */
export function DevTweaksEnabled({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DialRoot defaultOpen={false} position="bottom-left" productionEnabled />
    </>
  );
}
