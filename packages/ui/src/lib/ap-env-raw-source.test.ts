import assert from "node:assert/strict";
import { test } from "node:test";

import {
  apEnvRawSourceFromRows,
  apEnvRawSourceRows,
  applyApEnvRawSourceRowPatch,
  buildApEnvReferenceMenuItems,
  compileApEnvRawSourceForRuntime,
  insertApEnvReferenceText,
  parseApEnvRawSource,
  resolveApEnvRawSourceReferences,
} from "./ap-env-raw-source";

const postgresSource = {
  name: "postgres",
  namespace: "default",
  primitiveSecretRefs: {
    host: { key: "endpoint", name: "postgres-conn-credential" },
    password: { key: "passwd", name: "postgres-conn-credential" },
    port: { key: "port", name: "postgres-conn-credential" },
    username: { key: "user", name: "postgres-conn-credential" },
  },
};

function referenceExpression(db: string, variable: string): string {
  return ["$", "{{", db, ".", variable, "}}"].join("");
}

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

test("AP env raw source normalizes DB references by DB identity and variable name", () => {
  const resolved = resolveApEnvRawSourceReferences(
    [
      `DATABASE_URL=${referenceExpression("Postgres", "database_url")}`,
      `HOST=${referenceExpression("postgres", "pg_host")}`,
    ].join("\n"),
    [
      {
        name: "postgres",
        namespace: "default",
        primitiveSecretRefs: {
          host: { key: "endpoint", name: "postgres-conn-credential" },
        },
      },
    ]
  );

  assert.equal(resolved.valid, true);
  assert.equal(
    resolved.source,
    [
      `DATABASE_URL=${referenceExpression("postgres", "DATABASE_URL")}`,
      `HOST=${referenceExpression("postgres", "PG_HOST")}`,
    ].join("\n")
  );
});

test("AP env reference menu lists variable metadata and inserts canonical expressions", () => {
  const items = buildApEnvReferenceMenuItems([postgresSource]);

  assert.deepEqual(
    items.slice(0, 2).map((item) => ({
      available: item.available,
      description: item.description,
      expression: item.expression,
      label: item.label,
      type: item.type,
    })),
    [
      {
        available: true,
        description: "Available",
        expression: referenceExpression("postgres", "DATABASE_URL"),
        label: "DATABASE_URL",
        type: "Alias",
      },
      {
        available: true,
        description: "Available",
        expression: referenceExpression("postgres", "PG_USER"),
        label: "PG_USER",
        type: "Secret",
      },
    ]
  );
  const incompleteReference = `DATABASE_URL=${["$", "{{", "post"].join("")}`;
  assert.equal(
    insertApEnvReferenceText(
      incompleteReference,
      referenceExpression("postgres", "DATABASE_URL"),
      incompleteReference.length,
      incompleteReference.length
    ),
    `DATABASE_URL=${referenceExpression("postgres", "DATABASE_URL")}`
  );
  assert.equal(
    insertApEnvReferenceText(
      "prefix",
      referenceExpression("postgres", "PG_HOST"),
      6,
      6
    ),
    `prefix${referenceExpression("postgres", "PG_HOST")}`
  );
});

test("AP env raw source compiler generates stable Secret-backed DATABASE_URL helpers", () => {
  const compiled = compileApEnvRawSourceForRuntime(
    [
      "PGUSER=manual",
      `DATABASE_URL=${referenceExpression("postgres", "DATABASE_URL")}?sslmode=require`,
      `READ_REPLICA_URL=${referenceExpression("postgres", "DATABASE_URL")}/readonly`,
    ].join("\n"),
    [postgresSource]
  );

  assert.equal(compiled.valid, true);
  assert.deepEqual(
    compiled.env.map(
      ({
        compiledReference: _compiledReference,
        dbDsn: _dbDsn,
        helper: _helper,
        ...row
      }) => row
    ),
    [
      { name: "PGUSER", value: "manual" },
      {
        name: "DATABASE_URL",
        value:
          "postgresql://$(POSTGRES_USERNAME):$(POSTGRES_PASSWORD)@$(POSTGRES_HOST):$(POSTGRES_PORT)?sslmode=require",
      },
      {
        name: "READ_REPLICA_URL",
        value:
          "postgresql://$(POSTGRES_USERNAME):$(POSTGRES_PASSWORD)@$(POSTGRES_HOST):$(POSTGRES_PORT)/readonly",
      },
      {
        name: "POSTGRES_USERNAME",
        value: "(valueFrom)",
        valueFrom: {
          secretKeyRef: { key: "user", name: "postgres-conn-credential" },
        },
        valueSource: "valueFrom",
      },
      {
        name: "POSTGRES_PASSWORD",
        value: "(valueFrom)",
        valueFrom: {
          secretKeyRef: { key: "passwd", name: "postgres-conn-credential" },
        },
        valueSource: "valueFrom",
      },
      {
        name: "POSTGRES_HOST",
        value: "(valueFrom)",
        valueFrom: {
          secretKeyRef: { key: "endpoint", name: "postgres-conn-credential" },
        },
        valueSource: "valueFrom",
      },
      {
        name: "POSTGRES_PORT",
        value: "(valueFrom)",
        valueFrom: {
          secretKeyRef: { key: "port", name: "postgres-conn-credential" },
        },
        valueSource: "valueFrom",
      },
    ]
  );
  assert.deepEqual(compiled.env[1]?.compiledReference?.helpers, [
    {
      field: "username",
      name: "POSTGRES_USERNAME",
      valueFrom: {
        secretKeyRef: { key: "user", name: "postgres-conn-credential" },
      },
    },
    {
      field: "password",
      name: "POSTGRES_PASSWORD",
      valueFrom: {
        secretKeyRef: { key: "passwd", name: "postgres-conn-credential" },
      },
    },
    {
      field: "host",
      name: "POSTGRES_HOST",
      valueFrom: {
        secretKeyRef: { key: "endpoint", name: "postgres-conn-credential" },
      },
    },
    {
      field: "port",
      name: "POSTGRES_PORT",
      valueFrom: {
        secretKeyRef: { key: "port", name: "postgres-conn-credential" },
      },
    },
  ]);
});

test("AP env raw source compiler blocks broken DB references", () => {
  const compiled = compileApEnvRawSourceForRuntime(
    [
      `DATABASE_URL=${referenceExpression("missing", "DATABASE_URL")}`,
      `HOST=${referenceExpression("postgres", "NOPE")}`,
    ].join("\n"),
    [postgresSource]
  );

  assert.equal(compiled.valid, false);
  assert.deepEqual(
    compiled.diagnostics.map((diagnostic) => ({
      line: diagnostic.line,
      message: diagnostic.message,
      type: diagnostic.type,
    })),
    [
      {
        line: 1,
        message: 'DB Reference "missing" was not found.',
        type: "unresolved-reference",
      },
      {
        line: 2,
        message: 'DB Reference variable "NOPE" is not available on postgres.',
        type: "unresolved-reference",
      },
    ]
  );
});
