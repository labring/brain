import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const visibleSurfaceFiles = [
  "apps/ui/src/features/db-browser/components/database/sql/TableView/TableView.Toolbar.tsx",
  "apps/ui/src/features/db-browser/components/database/mongodb/CollectionView/CollectionView.Toolbar.tsx",
  "apps/ui/src/features/db-browser/components/database/redis/RedisKeyDetailView.tsx",
];

const forbiddenVisibleActions = new Set([
  "add",
  "chart",
  "clear",
  "copy",
  "create",
  "delete",
  "edit",
  "filter",
  "new",
  "preview",
  "query",
  "submit",
  "undo",
  "write",
]);

function dataQaActions(source: string) {
  return [...source.matchAll(/data-qa-action="([^"]+)"/g)].map(
    (match) => match[1] ?? ""
  );
}

test("visible database detail toolbars expose only refresh and single-object export", () => {
  const actions = new Set<string>();

  for (const file of visibleSurfaceFiles) {
    for (const action of dataQaActions(readFileSync(file, "utf8"))) {
      actions.add(action);
    }
  }

  assert.deepEqual([...actions].sort(), ["export", "refresh"].sort());
  assert.equal(
    [...actions].some((action) => forbiddenVisibleActions.has(action)),
    false
  );
});
