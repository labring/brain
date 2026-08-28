"use client";

import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";

import {
  evaluateStatusHints,
  reconcileDismissed,
  type StatusHint,
  type StatusHintId,
  selectStatusHint,
} from "./status-hint-model";
import { statusHintDismissedAtom } from "./status-hint-store";
import { useStatusHintInputs } from "./use-status-hint-inputs";

export interface StatusHintSlot {
  dismiss: (id: StatusHintId) => void;
  hint: StatusHint | null;
}

/**
 * The single slot's contents, evaluated from the shared billing-state
 * inputs (`useStatusHintInputs`).
 */
export function useStatusHint(): StatusHintSlot {
  const inputs = useStatusHintInputs();
  const evaluation = useMemo(() => evaluateStatusHints(inputs), [inputs]);

  const [dismissed, setDismissed] = useAtom(statusHintDismissedAtom);
  useEffect(() => {
    setDismissed((previous) => reconcileDismissed(previous, evaluation));
  }, [evaluation, setDismissed]);
  const dismiss = useCallback(
    (id: StatusHintId) => {
      setDismissed((previous) =>
        previous.includes(id) ? previous : [...previous, id]
      );
    },
    [setDismissed]
  );

  return { dismiss, hint: selectStatusHint(evaluation.hints, dismissed) };
}
