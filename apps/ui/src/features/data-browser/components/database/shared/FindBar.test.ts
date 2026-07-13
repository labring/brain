import assert from "node:assert/strict";
import { test } from "node:test";

import { findMatches } from "./FindBar";

test("Find matches only the current loaded rows and searchable columns", () => {
  const rows = [
    { email: "alice@example.com", name: "Alice" },
    { email: "bob@example.com", name: "Bob" },
  ];

  assert.deepEqual(findMatches(rows, ["name"], "ALI"), [
    { columnKey: "name", rowIndex: 0 },
  ]);
  assert.deepEqual(findMatches(rows, ["name"], "example.com"), []);
});

test("Find returns no matches for blank terms", () => {
  assert.deepEqual(findMatches([{ name: "Alice" }], ["name"], "  "), []);
});
