import assert from "node:assert/strict";
import { test } from "node:test";

import type { ProjectDbTarget } from "@/features/panes/target-identity";
import {
  canvasSelectionForRestoredDbService,
  DB_RESTORE_CANVAS_FOCUS_TIMEOUT_MS,
  restoredDbServiceTargetFromAccepted,
  shouldCancelPendingDbServiceRestoreFocus,
} from "./db-restore-focus";

const source: ProjectDbTarget = {
  kind: "DB",
  name: "orders-db",
  namespace: "database-system",
};

const restored: ProjectDbTarget = {
  kind: "DB",
  name: "orders-db-restore",
  namespace: "database-system",
};

test("DB Service restore canvas focus waits for ten seconds", () => {
  assert.equal(DB_RESTORE_CANVAS_FOCUS_TIMEOUT_MS, 10_000);
});

test("accepted restored DB Service target normalizes name and namespace", () => {
  assert.deepEqual(
    restoredDbServiceTargetFromAccepted({
      name: " orders-db-restore ",
      namespace: " database-system ",
    }),
    restored
  );
  assert.equal(
    restoredDbServiceTargetFromAccepted({
      name: " ",
      namespace: "database-system",
    }),
    null
  );
});

test("restored DB Service focus selects the restored DB resource", () => {
  assert.deepEqual(canvasSelectionForRestoredDbService(restored), {
    kind: "resource",
    target: restored,
  });
});

test("pending restored DB Service focus is cancelled after leaving source DB Access", () => {
  const pending = {
    id: 1,
    restoredTarget: restored,
    sourceTarget: source,
  };

  assert.equal(
    shouldCancelPendingDbServiceRestoreFocus({
      main: { kind: "dbAccess", target: source },
      pending,
    }),
    false
  );
  assert.equal(
    shouldCancelPendingDbServiceRestoreFocus({
      main: null,
      pending,
    }),
    true
  );
  assert.equal(
    shouldCancelPendingDbServiceRestoreFocus({
      main: { kind: "dbAccess", target: restored },
      pending,
    }),
    true
  );
});
