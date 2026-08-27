import { atomWithStorage, createJSONStorage } from "jotai/utils";

import type { StatusHintId } from "./status-hint-model";

/**
 * Ids of dismissible hints the user closed. Session-scoped so a reload keeps
 * a dismissal, while `reconcileDismissed` forgets it once its state is
 * settled absent — re-entry revives the banner (edge semantics).
 */
export const statusHintDismissedAtom = atomWithStorage<readonly StatusHintId[]>(
  "status-hint-dismissed",
  [],
  createJSONStorage(() => sessionStorage)
);
