import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deploymentTaskDockDismissalsStorageKey,
  parseDeploymentTaskDockDismissals,
  readDeploymentTaskDockDismissals,
  writeDeploymentTaskDockDismissals,
} from "./deployment-task-dock-dismissals";

function createMemoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    removeItem: (key: string) => {
      items.delete(key);
    },
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  } satisfies Pick<Storage, "getItem" | "removeItem" | "setItem">;
}

test("deployment task dock dismissal storage keys are scoped by namespace and project", () => {
  assert.equal(
    deploymentTaskDockDismissalsStorageKey({
      namespace: " team alpha ",
      projectId: "project/one",
    }),
    "sealai:deployment-task-dock-dismissals:team%20alpha:project%2Fone"
  );
});

test("deployment task dock dismissal parsing ignores malformed entries", () => {
  const dismissed = parseDeploymentTaskDockDismissals(
    JSON.stringify({
      " task-1 ": " 2026-06-17T10:00:00.000Z ",
      "": "2026-06-17T10:01:00.000Z",
      "task-2": "",
      "task-3": 42,
    })
  );

  assert.deepEqual(
    [...dismissed.entries()],
    [["task-1", "2026-06-17T10:00:00.000Z"]]
  );
  assert.deepEqual([...parseDeploymentTaskDockDismissals("not json")], []);
  assert.deepEqual([...parseDeploymentTaskDockDismissals("[]")], []);
});

test("deployment task dock dismissals round-trip through local storage", () => {
  const storage = createMemoryStorage();
  const scope = { namespace: "default", projectId: "project-1", storage };

  writeDeploymentTaskDockDismissals({
    ...scope,
    dismissedTaskUpdatedAtById: new Map([
      ["task-1", "2026-06-17T10:00:00.000Z"],
      ["task-2", "2026-06-17T10:01:00.000Z"],
    ]),
  });

  assert.deepEqual(
    [...readDeploymentTaskDockDismissals(scope).entries()],
    [
      ["task-1", "2026-06-17T10:00:00.000Z"],
      ["task-2", "2026-06-17T10:01:00.000Z"],
    ]
  );

  writeDeploymentTaskDockDismissals({
    ...scope,
    dismissedTaskUpdatedAtById: new Map(),
  });

  assert.deepEqual([...readDeploymentTaskDockDismissals(scope).entries()], []);
});
