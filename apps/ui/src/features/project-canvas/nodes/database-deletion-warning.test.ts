import assert from "node:assert/strict";
import { test } from "node:test";

import type { DatabaseNodeStates } from "@workspace/ui/components/database-node/database-node";

import { shouldShowDatabaseDeletionDelayHint } from "./database-deletion-warning";

const DELETION_TIMESTAMP = "2026-07-06T10:00:00Z";
const DELETION_STARTED_AT = Date.parse(DELETION_TIMESTAMP);

function states(
  overrides: Partial<DatabaseNodeStates> = {}
): DatabaseNodeStates {
  return {
    deletionTimestamp: DELETION_TIMESTAMP,
    displayEngine: "PostgreSQL",
    name: "postgres",
    status: { label: "Deleting", tone: "deleting" },
    ...overrides,
  };
}

test("does not show the database deletion delay hint before two minutes", () => {
  assert.equal(
    shouldShowDatabaseDeletionDelayHint({
      nowMs: DELETION_STARTED_AT + 2 * 60 * 1000 - 1,
      states: states(),
    }),
    false
  );
});

test("shows the database deletion delay hint after two minutes", () => {
  assert.equal(
    shouldShowDatabaseDeletionDelayHint({
      nowMs: DELETION_STARTED_AT + 2 * 60 * 1000,
      states: states(),
    }),
    true
  );
});

test("does not show the database deletion delay hint for non-deleting databases", () => {
  assert.equal(
    shouldShowDatabaseDeletionDelayHint({
      nowMs: DELETION_STARTED_AT + 2 * 60 * 1000,
      states: states({ status: { label: "Running", tone: "running" } }),
    }),
    false
  );
});

test("does not show the database deletion delay hint without a trusted deletion timestamp", () => {
  assert.equal(
    shouldShowDatabaseDeletionDelayHint({
      nowMs: DELETION_STARTED_AT + 2 * 60 * 1000,
      states: states({ deletionTimestamp: undefined }),
    }),
    false
  );
});

test("does not reuse a generic transient timestamp as the deletion start time", () => {
  assert.equal(
    shouldShowDatabaseDeletionDelayHint({
      nowMs: DELETION_STARTED_AT + 2 * 60 * 1000,
      states: {
        ...states({ deletionTimestamp: undefined }),
        transientSince: "2026-07-06T09:00:00Z",
      } as DatabaseNodeStates,
    }),
    false
  );
});
