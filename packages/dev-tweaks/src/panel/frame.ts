"use client";

import type { CSSProperties } from "react";
import { useEffect } from "react";

/** Applied while the panel chrome is mounted — carries the transitions. */
const HOST_CLASS = "dtp-frame-host";
/** Applied only while frame mode is docking the page. */
const FRAMED_CLASS = "dtp-framed";

const GAP_VAR = "--dtp-frame-gap";
const PANEL_W_VAR = "--dtp-frame-panel-w";
const DURATION_VAR = "--dtp-frame-ms";

export interface FrameModeInput {
  /** Transition length in ms; 0 under reduced motion. */
  durationMs: number;
  /** True only while the panel is open in frame mode. */
  framed: boolean;
  /** Card inset on every side, px. */
  gap: number;
  /** Width of the panel strip the card makes room for, px. */
  panelWidth: number;
  /** Host bridge custom properties (`--dtp-*`), forwarded to the root. */
  vars?: CSSProperties;
}

function customProperties(vars: CSSProperties | undefined): [string, string][] {
  return Object.entries(vars ?? {})
    .filter(([name]) => name.startsWith("--"))
    .map(([name, value]) => [name, String(value)]);
}

/**
 * Frame mode as a document-level effect: `<body>` becomes the inset card and
 * `<html>` carries the scrim. `styles.css` explains why the containment sits
 * on the body instead of on a wrapper element.
 *
 * The bridge variables ride up to `<html>` because both the body and the
 * top-layer panel need to read them, and neither one is a descendant of
 * anything this package renders.
 */
export function useFrameMode({
  durationMs,
  framed,
  gap,
  panelWidth,
  vars,
}: FrameModeInput): void {
  // Serialized so an inline `style` object literal cannot re-run the effect
  // on every render.
  const varsKey = JSON.stringify(customProperties(vars));

  useEffect(() => {
    const root = document.documentElement;
    const entries = JSON.parse(varsKey) as [string, string][];
    root.classList.add(HOST_CLASS);
    for (const [name, value] of entries) {
      root.style.setProperty(name, value);
    }
    return () => {
      root.classList.remove(HOST_CLASS);
      for (const [name] of entries) {
        root.style.removeProperty(name);
      }
    };
  }, [varsKey]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(GAP_VAR, `${gap}px`);
    root.style.setProperty(PANEL_W_VAR, `${panelWidth}px`);
    root.style.setProperty(DURATION_VAR, `${durationMs}ms`);
    root.classList.toggle(FRAMED_CLASS, framed);
    return () => {
      root.classList.remove(FRAMED_CLASS);
      root.style.removeProperty(GAP_VAR);
      root.style.removeProperty(PANEL_W_VAR);
      root.style.removeProperty(DURATION_VAR);
    };
  }, [durationMs, framed, gap, panelWidth]);
}
