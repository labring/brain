import assert from "node:assert/strict";
import { test } from "node:test";

import { DATA_BROWSER_CAPABILITIES } from "./capabilities";

test("DB Access first version exposes only supported engines and object kinds", () => {
  assert.deepEqual(
    [...DATA_BROWSER_CAPABILITIES.visibleEngines],
    ["POSTGRES", "MYSQL", "MONGODB", "REDIS"]
  );
  assert.deepEqual(
    [...DATA_BROWSER_CAPABILITIES.visibleObjectKinds],
    ["database", "schema", "table", "view", "collection", "key"]
  );
});

test("DB Access first version hides write, query, and advanced actions", () => {
  assert.equal(DATA_BROWSER_CAPABILITIES.actions.refresh, true);
  assert.equal(DATA_BROWSER_CAPABILITIES.actions.singleObjectExport, true);
  assert.equal(DATA_BROWSER_CAPABILITIES.actions.query, false);
  assert.equal(DATA_BROWSER_CAPABILITIES.actions.write, false);
  assert.equal(DATA_BROWSER_CAPABILITIES.actions.backendFilter, false);
  assert.equal(DATA_BROWSER_CAPABILITIES.actions.complexExport, false);
  assert.equal(DATA_BROWSER_CAPABILITIES.actions.chart, false);
});
