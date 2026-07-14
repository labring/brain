import type { DeploymentTaskTimelineSnapshotDTO } from "./types";

function dateMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Returns a value structurally equal to `next` that reuses references from
 * `prev` for every subtree that did not change — and returns `prev` itself when
 * nothing changed at all.
 *
 * The server re-sends a whole fresh object tree on every SSE tick, even when the
 * payload is identical or only one step moved. Reconciling against the previous
 * tree lets React bail out: an unchanged tick keeps the same top-level reference
 * (no render), and a changed tick keeps the references of every branch that did
 * not move (only the changed step/card re-renders, and stable `blockingInputs`/
 * `deploymentPlan` references stop the input form from resetting user entry).
 *
 * Both inputs must be plain JSON (objects, arrays, primitives), which the
 * timeline DTO always is — it comes straight from JSON.parse.
 */
function reconcile(prev: unknown, next: unknown): unknown {
  if (prev === next) {
    return prev;
  }
  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) {
      return next.map((item, index) =>
        index < prev.length ? reconcile(prev[index], item) : item
      );
    }
    const merged = next.map((item, index) => reconcile(prev[index], item));
    return merged.every((value, index) => value === prev[index])
      ? prev
      : merged;
  }
  if (isRecord(prev) && isRecord(next)) {
    const nextKeys = Object.keys(next);
    const merged: Record<string, unknown> = {};
    for (const key of nextKeys) {
      merged[key] = key in prev ? reconcile(prev[key], next[key]) : next[key];
    }
    const unchanged =
      Object.keys(prev).length === nextKeys.length &&
      nextKeys.every((key) => key in prev && merged[key] === prev[key]);
    return unchanged ? prev : merged;
  }
  return next;
}

/**
 * Picks the snapshot whose content should win — higher revision, then newer
 * `updatedAt` on a tie — without changing the accept/reject semantics the
 * timeline has always had. `reconcile` then decides the identity of the result.
 */
function chooseWinner(
  current: DeploymentTaskTimelineSnapshotDTO,
  incoming: DeploymentTaskTimelineSnapshotDTO
): DeploymentTaskTimelineSnapshotDTO {
  if (incoming.timeline.revision > current.timeline.revision) {
    return incoming;
  }
  if (incoming.timeline.revision < current.timeline.revision) {
    return current;
  }
  return dateMs(incoming.timeline.updatedAt) >=
    dateMs(current.timeline.updatedAt)
    ? incoming
    : current;
}

export function applyDeploymentTaskTimelineSnapshot(
  current: DeploymentTaskTimelineSnapshotDTO | null,
  incoming: DeploymentTaskTimelineSnapshotDTO
): DeploymentTaskTimelineSnapshotDTO {
  if (current == null || current.timeline.taskId !== incoming.timeline.taskId) {
    return incoming;
  }
  return reconcile(
    current,
    chooseWinner(current, incoming)
  ) as DeploymentTaskTimelineSnapshotDTO;
}
