"use client";

import { useEffect, useState } from "react";

/**
 * True while `deadlineMs` (epoch ms) lies in the future; `0` means no
 * deadline. The clock is read inside an effect and the flip is scheduled
 * with a timer, so consumers re-render exactly when the deadline passes
 * instead of comparing against Date.now() during render.
 */
export function useDeadlineNotReached(deadlineMs: number): boolean {
  const [reachedFor, setReachedFor] = useState<number | null>(null);

  useEffect(() => {
    if (deadlineMs <= 0) {
      return;
    }
    const delay = Math.max(0, deadlineMs - Date.now());
    const timer = setTimeout(() => setReachedFor(deadlineMs), delay);
    return () => clearTimeout(timer);
  }, [deadlineMs]);

  return deadlineMs > 0 && reachedFor !== deadlineMs;
}
