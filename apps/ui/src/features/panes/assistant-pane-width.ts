const ASSISTANT_PANE_WIDTH_STORAGE_KEY = "brain.assistant-pane-width";

export const ASSISTANT_PANE_DEFAULT_WIDTH = 416;
export const ASSISTANT_PANE_MIN_WIDTH = 320;
export const ASSISTANT_PANE_MAX_WORKSPACE_FRACTION = 0.5;
export const ASSISTANT_PANE_RESIZE_STEP = 16;

/** Largest Assistant Pane Width the given workspace affords. */
export function assistantPaneMaxWidth(workspaceWidth: number): number {
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) {
    return ASSISTANT_PANE_MIN_WIDTH;
  }
  return Math.max(
    ASSISTANT_PANE_MIN_WIDTH,
    Math.round(workspaceWidth * ASSISTANT_PANE_MAX_WORKSPACE_FRACTION)
  );
}

/**
 * Presentation clamp for the remembered Assistant Pane Width. An unknown
 * workspace width only enforces the minimum so the remembered intent is kept.
 */
export function clampAssistantPaneWidth(
  width: number,
  workspaceWidth: number
): number {
  if (!Number.isFinite(width)) {
    return ASSISTANT_PANE_DEFAULT_WIDTH;
  }
  const max =
    Number.isFinite(workspaceWidth) && workspaceWidth > 0
      ? assistantPaneMaxWidth(workspaceWidth)
      : Number.POSITIVE_INFINITY;
  return Math.min(Math.max(Math.round(width), ASSISTANT_PANE_MIN_WIDTH), max);
}

export function parseAssistantPaneWidth(raw: string | null): number | null {
  if (raw == null) {
    return null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= ASSISTANT_PANE_MIN_WIDTH
    ? parsed
    : null;
}

export function readStoredAssistantPaneWidth(): number | null {
  try {
    return parseAssistantPaneWidth(
      window.localStorage.getItem(ASSISTANT_PANE_WIDTH_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

export function writeStoredAssistantPaneWidth(width: number | null): void {
  try {
    if (width == null) {
      window.localStorage.removeItem(ASSISTANT_PANE_WIDTH_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      ASSISTANT_PANE_WIDTH_STORAGE_KEY,
      String(Math.round(width))
    );
  } catch {
    // Storage unavailable (e.g. private mode); the width stays session-local.
  }
}
