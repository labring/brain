"use client";

import "@workspace/dev-tweaks/styles.css";

import { DevTweaksRoot } from "@workspace/dev-tweaks";
import type { ReactNode } from "react";

const DEMO_BUILD = process.env.NEXT_PUBLIC_DEV_TWEAKS === "1";

/**
 * Dev-only composition root: mounts the dev tweaks panel once for the whole
 * app. Panels register from `useDevTweaks` call sites; the panel opens with
 * ⌃⌥T and docks the page as an inset card (frame posture, the remembered
 * default) or floats as a corner card.
 *
 * The launcher bubble (bottom-left, where the old indicator capsule lived) is
 * a dirty indicator in local dev — hidden until an override is active. Demo
 * builds pin it instead: their audience can't be assumed to know the hotkey,
 * so the bubble stays as the visible way in.
 *
 * The compile-time gate lives in `dev-tweaks.tsx`. Once this module mounts,
 * the root renders.
 */
export function DevTweaksEnabled({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DevTweaksRoot
        defaultOpen={false}
        launcher={DEMO_BUILD ? "always" : "dirty"}
        position="bottom-left"
      />
    </>
  );
}
