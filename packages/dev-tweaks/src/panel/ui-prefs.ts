/**
 * Panel chrome preferences — presentation mode, snap corner, float height.
 * Deliberately localStorage (they may outlive the tab): these are workspace
 * posture, not control overrides.
 */

export type PanelMode = "float" | "frame";
export type PanelCorner = "bl" | "br" | "tl" | "tr";

export interface PanelPrefs {
  corner: PanelCorner;
  floatHeight: number | null;
  mode: PanelMode;
}

const PREFS_KEY = "dev-tweaks.ui.v1";

export const DEFAULT_PANEL_PREFS: PanelPrefs = {
  corner: "br",
  floatHeight: null,
  mode: "frame",
};

const MODES: readonly PanelMode[] = ["float", "frame"];
const CORNERS: readonly PanelCorner[] = ["bl", "br", "tl", "tr"];

export function loadPanelPrefs(): PanelPrefs {
  if (typeof window === "undefined") {
    return DEFAULT_PANEL_PREFS;
  }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) {
      return DEFAULT_PANEL_PREFS;
    }
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    return {
      corner: CORNERS.includes(parsed.corner as PanelCorner)
        ? (parsed.corner as PanelCorner)
        : DEFAULT_PANEL_PREFS.corner,
      floatHeight:
        typeof parsed.floatHeight === "number" &&
        Number.isFinite(parsed.floatHeight)
          ? parsed.floatHeight
          : null,
      mode: MODES.includes(parsed.mode as PanelMode)
        ? (parsed.mode as PanelMode)
        : DEFAULT_PANEL_PREFS.mode,
    };
  } catch {
    return DEFAULT_PANEL_PREFS;
  }
}

export function savePanelPrefs(prefs: PanelPrefs): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences simply won't stick.
  }
}
