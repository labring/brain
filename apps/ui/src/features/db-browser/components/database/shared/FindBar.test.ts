import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFindCorpus,
  findCellHighlight,
  findInCorpus,
  findRowHighlight,
} from "./FindBar";

test("Find matches only the current loaded rows and searchable columns", () => {
  const rows = [
    { email: "alice@example.com", name: "Alice" },
    { email: "bob@example.com", name: "Bob" },
  ];

  const corpus = buildFindCorpus(rows, ["name"]);
  assert.deepEqual(findInCorpus(corpus, "ALI").matches, [
    { columnKey: "name", rowIndex: 0 },
  ]);
  assert.deepEqual(findInCorpus(corpus, "example.com").matches, []);
});

test("Find returns no matches for blank terms", () => {
  assert.deepEqual(
    findInCorpus(buildFindCorpus([{ name: "Alice" }], ["name"]), "  ").matches,
    []
  );
});

test("Find normalizes cell values once when the corpus is built", () => {
  let stringConversions = 0;
  const value = {
    toString() {
      stringConversions += 1;
      return "Alice";
    },
  };
  const corpus = buildFindCorpus([{ name: value }], ["name"]);

  assert.deepEqual(findInCorpus(corpus, "ali").matches, [
    { columnKey: "name", rowIndex: 0 },
  ]);
  assert.deepEqual(findInCorpus(corpus, "ICE").matches, [
    { columnKey: "name", rowIndex: 0 },
  ]);
  assert.equal(stringConversions, 1);
});

test("Find builds matches and constant-time highlight indexes in one result", () => {
  const corpus = buildFindCorpus(
    [
      { email: "needle", name: "needle" },
      { email: "other", name: "other" },
      { email: "other", name: "needle" },
    ],
    ["name", "email"]
  );
  const result = findInCorpus(corpus, "needle");
  const matches = result.matches;

  assert.deepEqual(matches, [
    { columnKey: "name", rowIndex: 0 },
    { columnKey: "email", rowIndex: 0 },
    { columnKey: "name", rowIndex: 2 },
  ]);
  assert.equal(
    findCellHighlight(result.highlightIndex, matches[1], 0, "name"),
    "match"
  );
  assert.equal(
    findCellHighlight(result.highlightIndex, matches[1], 0, "email"),
    "current"
  );
  assert.equal(
    findCellHighlight(result.highlightIndex, matches[1], 1, "name"),
    null
  );
  assert.equal(
    findRowHighlight(result.highlightIndex, matches[1], 0),
    "current"
  );
  assert.equal(findRowHighlight(result.highlightIndex, matches[1], 2), "match");
  assert.equal(findRowHighlight(result.highlightIndex, matches[1], 1), null);
});

test("100 by 20 results change only the old and new current cell props", () => {
  const columns = Array.from({ length: 20 }, (_, index) => `column-${index}`);
  const rows = Array.from({ length: 100 }, () =>
    Object.fromEntries(columns.map((column) => [column, "needle"]))
  );
  const corpus = buildFindCorpus(rows, columns);
  const result = findInCorpus(corpus, "needle");
  const previousMatch = result.matches[0];
  const nextMatch = result.matches[1];
  let changedHighlightCount = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (const column of columns) {
      const previousHighlight = findCellHighlight(
        result.highlightIndex,
        previousMatch,
        rowIndex,
        column
      );
      const nextHighlight = findCellHighlight(
        result.highlightIndex,
        nextMatch,
        rowIndex,
        column
      );
      if (previousHighlight !== nextHighlight) {
        changedHighlightCount += 1;
      }
    }
  }

  assert.equal(corpus.length, 2000);
  assert.equal(result.matches.length, 2000);
  assert.equal(result.highlightIndex.cellKeys.size, 2000);
  assert.equal(result.highlightIndex.rowIndexes.size, 100);
  assert.equal(changedHighlightCount, 2);
});
