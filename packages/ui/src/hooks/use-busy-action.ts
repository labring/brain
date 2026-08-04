"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Wraps a control's action with in-flight tracking: `trigger` ignores
 * re-entry while the action is running (checked synchronously, so a
 * double-click cannot fire twice) and `busy` feeds the control's busy
 * indicator. A synchronous action never reads as busy. Rejections are the
 * action's own to surface — trigger swallows them so a failed action simply
 * returns the control to rest.
 */
export function useBusyAction(action: () => unknown): {
  busy: boolean;
  trigger: () => void;
} {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const trigger = useCallback(() => {
    if (busyRef.current) {
      return;
    }
    const result = action();
    if (!(result instanceof Promise)) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    result
      .catch(() => undefined)
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  }, [action]);

  return { busy, trigger };
}
