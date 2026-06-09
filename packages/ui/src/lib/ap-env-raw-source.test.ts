import assert from "node:assert/strict";
import { test } from "node:test";

import {
  apEnvRawSourceFromRows,
  apEnvRawSourceRows,
  applyApEnvRawSourceRowPatch,
  parseApEnvRawSource,
} from "./ap-env-raw-source";

test("AP env raw source parser preserves comments, blank lines, ordering, inline comments, and formatting", () => {
  const source = [
    "# database",
    "",
    "DATABASE_URL='postgres://db:5432/app' # private dsn",
    "RUNTIME=$(DATABASE_URL)",
    'QUOTED="hello # not a comment"',
    "",
  ].join("\n");

  const parsed = parseApEnvRawSource(source);

  assert.equal(parsed.valid, true);
  assert.deepEqual(
    parsed.rows.map((row) => ({
      key: row.key,
      rawValue: row.rawValue,
      value: row.value,
    })),
    [
      {
        key: "DATABASE_URL",
        rawValue: "'postgres://db:5432/app'",
        value: "postgres://db:5432/app",
      },
      {
        key: "RUNTIME",
        rawValue: "$(DATABASE_URL)",
        value: "$(DATABASE_URL)",
      },
      {
        key: "QUOTED",
        rawValue: '"hello # not a comment"',
        value: "hello # not a comment",
      },
    ]
  );
  assert.equal(parsed.source, source);
});

test("AP env raw source parser rejects syntax errors and duplicate keys", () => {
  assert.deepEqual(parseApEnvRawSource("MISSING").diagnostics, [
    {
      line: 1,
      message: "Expected KEY=VALUE.",
      type: "syntax",
    },
  ]);

  assert.deepEqual(parseApEnvRawSource("A=1\nA=2").diagnostics, [
    {
      key: "A",
      line: 2,
      message: "Environment variable names must be unique.",
      type: "duplicate-name",
    },
  ]);
});

test("AP env raw source projects saved direct env rows when raw source is absent", () => {
  assert.equal(
    apEnvRawSourceFromRows([
      { name: "DATABASE_URL", value: "postgres://db:5432/app" },
      { name: "RUNTIME", value: "$(DATABASE_URL)" },
    ]),
    "DATABASE_URL=postgres://db:5432/app\nRUNTIME=$(DATABASE_URL)"
  );
});

test("AP env structured row patches preserve nearby raw source comments and formatting", () => {
  const source = [
    "# database",
    "DATABASE_URL='postgres://old' # private dsn",
    "",
    "# app",
    "FEATURE_FLAG=true",
  ].join("\n");

  const next = applyApEnvRawSourceRowPatch(source, 0, {
    value: "postgres://new",
  });

  assert.equal(
    next.source,
    [
      "# database",
      "DATABASE_URL='postgres://new' # private dsn",
      "",
      "# app",
      "FEATURE_FLAG=true",
    ].join("\n")
  );

  assert.deepEqual(apEnvRawSourceRows(next.source), [
    { name: "DATABASE_URL", value: "postgres://new" },
    { name: "FEATURE_FLAG", value: "true" },
  ]);
});
