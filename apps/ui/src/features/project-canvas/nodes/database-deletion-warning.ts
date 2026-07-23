import type { DatabaseNodeStates } from "@workspace/ui/components/database-node/database-node";
import { useEffect, useState } from "react";

const DATABASE_DELETION_DELAY_HINT_MS = 2 * 60 * 1000;

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
    nowMs - deletionStartedAt >= DATABASE_DELETION_DELAY_HINT_MS
  );
}

/**
 * True once the database has been deleting for the hint delay. The clock is
 * read in an effect and the flip is scheduled, so the hint appears on time
 * even if nothing else re-renders the node.
 */
export function useShowDatabaseDeletionDelayHint(
  states: DatabaseNodeStates
): boolean {
  const deletionStartedAt = databaseDeletionStartedAtMs(states);
  const [visibleFor, setVisibleFor] = useState<number | null>(null);

  useEffect(() => {
    if (deletionStartedAt === undefined) {
      return;
    }
    const delay = Math.max(
      0,
      deletionStartedAt + DATABASE_DELETION_DELAY_HINT_MS - Date.now()
    );
    const timer = setTimeout(() => setVisibleFor(deletionStartedAt), delay);
    return () => clearTimeout(timer);
  }, [deletionStartedAt]);

  return deletionStartedAt !== undefined && visibleFor === deletionStartedAt;
}
