"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Celebrating a verified-successful Deployment Task is a one-shot event, not a
 * render side effect (issue #160). The Timeline is a live surface: it re-renders
 * on every stream tick, remounts when the pane is reopened, and on a refresh
 * lands directly on the already-successful snapshot. Firing confetti from any of
 * those would mean a party that replays every time the user looks.
 *
 * So the decision is split in three:
 * - the claim registry is page-session state keyed by task id + success revision,
 *   which is what makes replays impossible.
 * - the open celebration windows are a store outside React that the hook
 *   subscribes to, so starting a window never writes React state from inside an
 *   effect body. Each window records which mount opened it, so a second pane
 *   for the same success reads the open window, does not own it, and stays
 *   without confetti.
 * - the hook additionally requires a transition observed while mounted, so
 *   entering an already-completed task never celebrates.
 */

export const DEPLOYMENT_TASK_SUCCESS_CELEBRATION_MS = 1600;

const claimedCelebrations = new Set<string>();
/**
 * The celebration windows open right now, each keyed by its claim and owned
 * by the mount that opened it. Ownership is what keeps a second pane for the
 * same task + revision from drawing a second confetti layer while the first
 * window is still running.
 */
const openCelebrations = new Map<string, number>();
/** Distinguishes mounts: useId() repeats across separate roots, a counter does not. */
let nextCelebrationOwnerId = 0;

function claimCelebrationOwnerId(): number {
  nextCelebrationOwnerId += 1;
  return nextCelebrationOwnerId;
}
const celebrationListeners = new Set<() => void>();

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
  openCelebrations.clear();
}

function notifyCelebrationListeners(): void {
  for (const listener of celebrationListeners) {
    listener();
  }
}

function subscribeToCelebrationWindows(listener: () => void): () => void {
  celebrationListeners.add(listener);
  return () => {
    celebrationListeners.delete(listener);
  };
}

/**
 * Drives one celebration: true from the moment a live transition to verified
 * success is observed until the celebration window closes. The window only
 * owns the confetti; the Timeline remains open until the user closes it.
 */
export function useDeploymentTaskSuccessCelebration(input: {
  celebrationMs?: number;
  successRevision: number | null;
  taskId: string;
}): boolean {
  const celebrationMs =
    input.celebrationMs ?? DEPLOYMENT_TASK_SUCCESS_CELEBRATION_MS;

  // Identifies this mount: a celebration belongs to the mount that observed
  // the transition, not to every viewer of the same success. useState keeps
  // it stable across re-renders and unique across roots.
  const [ownerId] = useState(claimCelebrationOwnerId);
  const key =
    input.successRevision == null
      ? null
      : deploymentTaskSuccessCelebrationKey(
          input.taskId,
          input.successRevision
        );
  // Undefined means nothing has been observed yet in this mount, which is the
  // one state that must not celebrate: a refresh onto a finished task is not a
  // transition the user watched happen.
  const observedKeyRef = useRef<string | null | undefined>(undefined);

  const openWindow = useSyncExternalStore(
    subscribeToCelebrationWindows,
    () => (key != null && openCelebrations.get(key) === ownerId ? key : null),
    () => null
  );

  useEffect(() => {
    const firstObservation = observedKeyRef.current === undefined;
    const previousKey = observedKeyRef.current ?? null;
    observedKeyRef.current = key;
    if (key == null || firstObservation || previousKey === key) {
      return;
    }
    if (!claimDeploymentTaskSuccessCelebration(key)) {
      return;
    }
    openCelebrations.set(key, ownerId);
    notifyCelebrationListeners();
    const close = () => {
      if (openCelebrations.get(key) === ownerId) {
        openCelebrations.delete(key);
        notifyCelebrationListeners();
      }
    };
    const timer = setTimeout(() => {
      close();
    }, celebrationMs);
    return () => {
      clearTimeout(timer);
      close();
    };
  }, [celebrationMs, key, ownerId]);

  return key != null && openWindow === key;
}
