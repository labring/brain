"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { REVEAL_DURATION_MS } from "./secret-reveal";
import { toastErrorDetail } from "./toast-utils";

export interface RevealedRow {
  key: string;
  value: string;
}

/**
 * One revealed secret row at a time (ADR-0055): revealing a row replaces any
 * previously revealed one, the reveal auto-hides after
 * REVEAL_DURATION_MS, and toggling the revealed row hides it early.
 * A failed resolve surfaces a toast — matching the copy pipeline and the AP
 * Environment editor — while an empty value leaves the mask in place
 * silently, since nothing failed and there is nothing to show.
 */
export function useRevealedRow(): {
  revealedRow: RevealedRow | null;
  toggleRevealedRow: (
    key: string,
    resolveValue: () => Promise<string>
  ) => Promise<void>;
} {
  const [revealedRow, setRevealedRow] = useState<RevealedRow | null>(null);
  const revealedKeyRef = useRef<string | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current !== null) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearHideTimeout, [clearHideTimeout]);

  const hideRevealedRow = useCallback(() => {
    clearHideTimeout();
    revealedKeyRef.current = null;
    setRevealedRow(null);
  }, [clearHideTimeout]);

  const toggleRevealedRow = useCallback(
    async (key: string, resolveValue: () => Promise<string>) => {
      if (revealedKeyRef.current === key) {
        hideRevealedRow();
        return;
      }
      let value: string;
      try {
        value = await resolveValue();
      } catch {
        toastErrorDetail(
          "Reveal failed.",
          "The connection string could not be fetched."
        );
        return;
      }
      if (value === "") {
        return;
      }
      clearHideTimeout();
      revealedKeyRef.current = key;
      setRevealedRow({ key, value });
      hideTimeoutRef.current = setTimeout(() => {
        hideTimeoutRef.current = null;
        revealedKeyRef.current = null;
        setRevealedRow(null);
      }, REVEAL_DURATION_MS);
    },
    [clearHideTimeout, hideRevealedRow]
  );

  return { revealedRow, toggleRevealedRow };
}
