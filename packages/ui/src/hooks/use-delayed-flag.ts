"use client";

import { useEffect, useState } from "react";

/**
 * How long an in-flight action stays visually silent before its control
 * shows a busy indicator. Busy feedback belongs on the control itself when
 * the action's outcome lands at the control (reveal swaps the value into the
 * row, copy ends in copied feedback); the threshold keeps fast round-trips
 * from flashing a spinner that is gone before it is readable.
 */
export const BUSY_INDICATOR_DELAY_MS = 150;

/**
 * True once `active` has stayed true for `delayMs`, false the moment
 * `active` drops. Backs delayed busy indicators such as AppIconButton's
 * `busy` prop.
 */
export function useDelayedFlag(
  active: boolean,
  delayMs: number = BUSY_INDICATOR_DELAY_MS
): boolean {
  const [delayed, setDelayed] = useState(false);

  // Reset during render rather than in the effect, so the flag drops in the
  // same pass that `active` does instead of one cascading render later.
  if (!active && delayed) {
    setDelayed(false);
  }

  useEffect(() => {
    if (!active || delayMs <= 0) {
      return;
    }
    const timer = setTimeout(() => setDelayed(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);

  return active && (delayMs <= 0 || delayed);
}
