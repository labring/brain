import { useEffect } from "react";

/** Applied while the panel chrome is mounted — carries the transitions. */
const HOST_CLASS = "dev-tweaks-frame-host";
/** Applied only while frame posture is docking the page. */
const FRAMED_CLASS = "dev-tweaks-framed";

const GAP_VAR = "--dev-tweaks-frame-gap";
const PANEL_W_VAR = "--dev-tweaks-frame-panel-w";
const DURATION_VAR = "--dev-tweaks-frame-ms";

export interface FrameModeInput {
  /** Transition length in ms; 0 under reduced motion. */
  durationMs: number;
  /** True only while the panel is open in frame posture. */
  framed: boolean;
  /** Card inset on every side, px. */
  gap: number;
  /** Width of the panel strip the card makes room for, px. */
  panelWidth: number;
}

/**
 * Frame posture as a document-level effect: `<body>` becomes the inset card
 * and `<html>` carries the scrim. `theme.css` explains why the containment
 * sits on the body instead of on a wrapper element.
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
}: FrameModeInput): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(HOST_CLASS);
    return () => {
      root.classList.remove(HOST_CLASS);
    };
  }, []);

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
