"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long a control keeps saying "copied" before it reverts. Long enough to
 * read after a click, short enough that it never becomes a stale claim.
 */
export const COPY_FEEDBACK_MS = 2000;

/**
 * Copies `text` and reports whether the copy just happened.
 *
 * `copied` turns true only once the browser has accepted the write, so a
 * clipboard the page does not have (insecure context, denied permission) never
 * shows a check mark for text the user did not get. The reset timer is owned
 * here and cleared on unmount, so a control that goes away mid-window cannot
 * set state after the fact.
 */
export function useCopyFeedback(
  text: string,
  feedbackMs: number = COPY_FEEDBACK_MS
): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReset = useCallback(() => {
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearReset, [clearReset]);

  const copy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        clearReset();
        resetTimerRef.current = setTimeout(() => {
          resetTimerRef.current = null;
          setCopied(false);
        }, feedbackMs);
      })
      .catch(() => undefined);
  }, [clearReset, feedbackMs, text]);

  return [copied, copy];
}
