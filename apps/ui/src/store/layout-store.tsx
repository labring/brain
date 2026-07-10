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

/**
 * Bumped when a UI flow wants the assistant to switch to a fresh draft thread
 * (e.g. the project-creation pane just created a project, so the next words the
 * user types should start a new conversation, not extend the previous one).
 * Drafts are unsaved: the thread row materializes on the first message.
 */
export const assistantDraftThreadRequestAtom = atom(0);

/** Ask the Project Assistant Pane to switch to a fresh draft thread. */
export function requestAssistantDraftThread() {
  getDefaultStore().set(assistantDraftThreadRequestAtom, (n) => n + 1);
}

/** Toggle Project Assistant Pane visibility (uses app root default Jotai store). */
export function toggleAssistantPaneVisibility() {
  getDefaultStore().set(assistantPaneOpenAtom, (open) => !open);
}

/** Open the Project Assistant Pane. */
export function openAssistantPane() {
  getDefaultStore().set(assistantPaneOpenAtom, true);
}
