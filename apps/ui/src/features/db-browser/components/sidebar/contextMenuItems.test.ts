import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getCollectionMenuItems,
  getDatabaseMenuItems,
  getDbServiceMenuItems,
  getRedisKeyMenuItems,
  getSchemaMenuItems,
  getTableMenuItems,
  getViewMenuItems,
} from "./contextMenuItems";

const forbiddenActions = new Set([
  "new_query",
  "create_database",
  "new_database",
  "rename_database",
  "delete_database",
  "new_table",
  "rename_table",
  "delete_table",
  "copy_table",
  "clear_table",
  "new_collection",
  "drop_collection",
  "new_redis_key",
  "delete_redis_key",
  "toggle_system_objects",
  "export_database",
]);

function actionsFor(items: ReturnType<typeof getSchemaMenuItems>): string[] {
  const actions: string[] = [];
  for (const item of items) {
    if (!("separator" in item) && item.onClick) {
      item.onClick();
    }
  }
  return actions;
}

function callbacks(actions: string[]) {
  return {
    onAction: (action: string) => actions.push(action),
  };
}

test("context menus expose only refresh, export, and system-objects actions", () => {
  const menuFactories = [
    () => getDbServiceMenuItems("POSTGRES", callbacks(actions)),
    () => getDatabaseMenuItems("POSTGRES", callbacks(actions)),
    () => getSchemaMenuItems(callbacks(actions)),
    () => getTableMenuItems("POSTGRES", callbacks(actions)),
    () => getViewMenuItems(callbacks(actions)),
    () => getCollectionMenuItems(callbacks(actions)),
    () => getRedisKeyMenuItems(callbacks(actions)),
  ];
  const actions: string[] = [];

  for (const factory of menuFactories) {
    actionsFor(factory());
  }

  assert.deepEqual(
    [...new Set(actions)].sort(),
    [
      "export_collection",
      "export_data",
      "export_redis_key",
      "refresh",
      "show_system_objects",
    ].sort()
  );
  assert.equal(
    actions.some((action) => forbiddenActions.has(action)),
    false
  );
});

test("only postgres database menus offer the system objects reveal toggle", () => {
  const labelsFor = (items: ReturnType<typeof getDatabaseMenuItems>) =>
    items.flatMap((item) =>
      "separator" in item && item.separator ? [] : [item.label]
    );

  const hidden = getDatabaseMenuItems("POSTGRES", callbacks([]), {
    systemObjectsRevealed: false,
  });
  assert.ok(labelsFor(hidden).includes("Show system objects"));

  const revealed = getDatabaseMenuItems("POSTGRES", callbacks([]), {
    systemObjectsRevealed: true,
  });
  assert.ok(labelsFor(revealed).includes("Hide system objects"));

  for (const engine of ["MONGODB", "REDIS", "MYSQL"] as const) {
    const items = getDatabaseMenuItems(engine, callbacks([]));
    assert.equal(
      labelsFor(items).some((label) => label.includes("system objects")),
      false
    );
  }
});
