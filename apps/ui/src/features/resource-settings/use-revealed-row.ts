"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SETTINGS_REVEAL_DURATION_MS } from "./reveal";

export interface RevealedRow {
  key: string;
  value: string;
}

/**
 * One revealed secret row at a time (ADR-0054): revealing a row replaces any
 * previously revealed one, the reveal auto-hides after
 * SETTINGS_REVEAL_DURATION_MS, and toggling the revealed row hides it early.
 * Resolve failures and empty values leave the mask in place — reveal failure
 * stays silent, matching the AP Environment editor.
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
      }, SETTINGS_REVEAL_DURATION_MS);
    },
    [clearHideTimeout, hideRevealedRow]
  );

  return { revealedRow, toggleRevealedRow };
}
