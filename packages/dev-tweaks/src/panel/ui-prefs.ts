/**
 * Panel chrome preferences — presentation posture and the bubble's dragged
 * position. Deliberately localStorage (they may outlive the tab): these are
 * workspace posture, not control overrides.
 */

export type PanelPosture = "float" | "frame";
/** Header theme toggle choice; null until the user has picked one. */
export type PanelThemeChoice = "dark" | "light";

export interface PanelUiPrefs {
  /** Bubble drag offset (viewport px), restored across sessions. */
  floatOffset: { x: number; y: number } | null;
  posture: PanelPosture;
  /** Explicit theme override; null falls back to the mount-time prop. */
  theme: PanelThemeChoice | null;
}

const PREFS_KEY = "dev-tweaks.ui.v2";

export const DEFAULT_PANEL_UI_PREFS: PanelUiPrefs = {
  floatOffset: null,
  posture: "frame",
  theme: null,
};

const POSTURES: readonly PanelPosture[] = ["float", "frame"];
const THEME_CHOICES: readonly PanelThemeChoice[] = ["dark", "light"];

function isOffset(value: unknown): value is { x: number; y: number } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const offset = value as { x?: unknown; y?: unknown };
  return (
    typeof offset.x === "number" &&
    Number.isFinite(offset.x) &&
    typeof offset.y === "number" &&
    Number.isFinite(offset.y)
  );
}

export function loadPanelUiPrefs(): PanelUiPrefs {
  if (typeof window === "undefined") {
    return DEFAULT_PANEL_UI_PREFS;
  }
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) {
      return DEFAULT_PANEL_UI_PREFS;
    }
    const parsed = JSON.parse(raw) as Partial<PanelUiPrefs>;
    return {
      floatOffset: isOffset(parsed.floatOffset) ? parsed.floatOffset : null,
      posture: POSTURES.includes(parsed.posture as PanelPosture)
        ? (parsed.posture as PanelPosture)
        : DEFAULT_PANEL_UI_PREFS.posture,
      theme: THEME_CHOICES.includes(parsed.theme as PanelThemeChoice)
        ? (parsed.theme as PanelThemeChoice)
        : null,
    };
  } catch {
    return DEFAULT_PANEL_UI_PREFS;
  }
}

export function savePanelUiPrefs(prefs: PanelUiPrefs): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Preferences simply won't stick.
  }
}
