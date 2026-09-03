"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Celebrating a verified-successful Deployment Task is a one-shot event, not a
 * render side effect (issue #160). The Timeline is a live surface: it re-renders
 * on every stream tick, remounts when the pane is reopened, and on a refresh
 * lands directly on the already-successful snapshot. Firing confetti from any of
 * those would mean a party that replays every time the user looks.
 *
 * So the decision is split in two:
 * - the claim registry is page-session state keyed by task id + success revision,
 *   which is what makes replays impossible.
 * - the hook additionally requires a transition observed while mounted, so
 *   entering an already-completed task never celebrates.
 */

export const DEPLOYMENT_TASK_SUCCESS_CELEBRATION_MS = 1600;

const claimedCelebrations = new Set<string>();

/**
 * A success revision is its own claim: the same task re-deployed (and therefore
 * re-verified) may celebrate again, while the same conclusion replayed through
 * reconnects, refreshes or duplicate frames may not.
 */
export function deploymentTaskSuccessCelebrationKey(
  taskId: string,
  successRevision: number
): string {
  return `${taskId}:${successRevision}`;
}

/** Takes the one-shot right to celebrate a success. False when already spent. */
export function claimDeploymentTaskSuccessCelebration(key: string): boolean {
  if (claimedCelebrations.has(key)) {
    return false;
  }
  claimedCelebrations.add(key);
  return true;
}

/** Whether a success was already celebrated in this page session. */
export function hasDeploymentTaskSuccessCelebrationClaim(key: string): boolean {
  return claimedCelebrations.has(key);
}

/** Test-only: forget the session's claims so scenarios stay independent. */
export function resetDeploymentTaskSuccessCelebrationClaims(): void {
  claimedCelebrations.clear();
}

/**
 * Drives one celebration: true from the moment a live transition to verified
 * success is observed until the celebration window closes, when
 * `onCelebrated` fires — the Timeline's auto-close hook (show the result,
 * celebrate, then close).
 */
export function useDeploymentTaskSuccessCelebration(input: {
  celebrationMs?: number;
  onCelebrated?: () => void;
  successRevision: number | null;
  taskId: string;
}): boolean {
  const celebrationMs =
    input.celebrationMs ?? DEPLOYMENT_TASK_SUCCESS_CELEBRATION_MS;
  const [celebrating, setCelebrating] = useState(false);
  // Latest-callback ref: a celebration timer must never be re-armed merely
  // because the host re-created its inline onClose closure on a stream tick.
  const onCelebratedRef = useRef(input.onCelebrated);
  onCelebratedRef.current = input.onCelebrated;

  const key =
    input.successRevision == null
      ? null
      : deploymentTaskSuccessCelebrationKey(
          input.taskId,
          input.successRevision
        );
  // `undefined` means nothing has been observed yet in this mount, which is the
  // one state that must not celebrate: a refresh onto a finished task is not a
  // transition the user watched happen.
  const observedKeyRef = useRef<string | null | undefined>(undefined);
  const armedKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const firstObservation = observedKeyRef.current === undefined;
    const previousKey = observedKeyRef.current ?? null;
    observedKeyRef.current = key;

    if (key == null) {
      armedKeysRef.current.clear();
      setCelebrating((current) => (current ? false : current));
      return;
    }
    if (
      !firstObservation &&
      previousKey !== key &&
      claimDeploymentTaskSuccessCelebration(key)
    ) {
      armedKeysRef.current.add(key);
    }
    if (!armedKeysRef.current.has(key)) {
      return;
    }
    setCelebrating(true);
    const timer = setTimeout(() => {
      armedKeysRef.current.delete(key);
      setCelebrating((current) => (current ? false : current));
      onCelebratedRef.current?.();
    }, celebrationMs);
    return () => {
      clearTimeout(timer);
    };
  }, [celebrationMs, key]);

  return celebrating;
}
