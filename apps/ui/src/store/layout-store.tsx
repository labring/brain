import { atom, getDefaultStore } from "jotai";

import { ASSISTANT_PANE_DEFAULT_WIDTH } from "@/lib/assistant-pane-width";

/** When true, the project layout shows the persistent Project Assistant Pane. */
export const assistantPaneOpenAtom = atom(true);

/**
 * Committed Assistant Pane Width in px. A per-device presentation preference:
 * hydrated from browser storage on mount and clamped at render time, never
 * rewritten by transient workspace shrinking.
 */
export const assistantPaneWidthAtom = atom(ASSISTANT_PANE_DEFAULT_WIDTH);

/**
 * True while the user is dragging the Assistant Pane resize divider. Canvas
 * viewport focus follows instantly (no animation) while this is set.
 */
export const assistantPaneResizingAtom = atom(false);

/** Toggle Project Assistant Pane visibility (uses app root default Jotai store). */
export function toggleAssistantPaneVisibility() {
  getDefaultStore().set(assistantPaneOpenAtom, (open) => !open);
}

/** Open the Project Assistant Pane. */
export function openAssistantPane() {
  getDefaultStore().set(assistantPaneOpenAtom, true);
}
