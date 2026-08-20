"use client";

import "@workspace/dev-tweaks/styles.css";

import { DialRoot } from "@workspace/dev-tweaks";
import type { ReactNode } from "react";

const DEMO_BUILD = process.env.NEXT_PUBLIC_DEV_TWEAKS === "1";

/**
 * Dev-only composition root: mounts the DialKit panel once for the whole app.
 * Panels register from `useDialKit` call sites; the panel opens with ⌃⌥T and
 * docks the page as an inset card (frame posture, the remembered default) or
 * floats as a corner card.
 *
 * The launcher bubble (bottom-left, where the old indicator capsule lived) is
 * a dirty indicator in local dev — hidden until an override is active. Demo
 * builds pin it instead: their audience can't be assumed to know the hotkey,
 * so the bubble stays as the visible way in.
 *
 * `productionEnabled` because demo builds run with NODE_ENV=production — the
 * dev/demo gate lives in dev-tweaks.tsx.
 */
export function DevTweaksEnabled({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DialRoot
        defaultOpen={false}
        launcher={DEMO_BUILD ? "always" : "dirty"}
        position="bottom-left"
        productionEnabled
      />
    </>
  );
}
