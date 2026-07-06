import type { DatabaseNodeStates } from "@workspace/ui/components/database-node/database-node";

function normalizeDatabaseStatus(input: string | undefined) {
  return input
    ?.trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

export function isDatabaseDeleting(states: DatabaseNodeStates): boolean {
  return (
    normalizeDatabaseStatus(states.status?.tone) === "deleting" ||
    normalizeDatabaseStatus(states.status?.label) === "deleting"
  );
}

function databaseDeletionStartedAtMs(states: DatabaseNodeStates) {
  if (!isDatabaseDeleting(states)) {
    return undefined;
  }

  const deletionStartedAt = Date.parse(states.deletionTimestamp ?? "");
  return Number.isFinite(deletionStartedAt) ? deletionStartedAt : undefined;
}

export function shouldShowDatabaseDeletionDelayHint({
  nowMs,
  states,
}: {
  nowMs: number;
  states: DatabaseNodeStates;
}): boolean {
  const deletionStartedAt = databaseDeletionStartedAtMs(states);
  return (
    deletionStartedAt !== undefined &&
    nowMs - deletionStartedAt >= 2 * 60 * 1000
  );
}
