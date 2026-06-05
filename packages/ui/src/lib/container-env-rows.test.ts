import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addContainerEnvDbDsnReferenceRow,
  addContainerEnvRow,
  containerEnvDbDsnFieldOptions,
  containerEnvDbDsnReferenceFromValue,
  containerEnvRowsEqual,
  containerEnvRowsModelEqual,
  deleteContainerEnvRow,
  normalizeContainerEnvRowsForSave,
  updateContainerEnvRow,
  validateContainerEnvRows,
} from "./container-env-rows";

test("container env rows add, edit, and delete direct value rows", () => {
  const added = addContainerEnvRow([]);
  assert.deepEqual(added, [{ name: "NEW_VARIABLE", value: "" }]);

  const edited = updateContainerEnvRow(added, 0, {
    name: "DATABASE_URL",
    value: "postgres://db:5432/app",
  });
  assert.deepEqual(edited, [
    { name: "DATABASE_URL", value: "postgres://db:5432/app" },
  ]);

  assert.deepEqual(deleteContainerEnvRow(edited, 0), []);
});

test("container env rows reject duplicate names", () => {
  const result = validateContainerEnvRows([
    { name: "DATABASE_URL", value: "postgres://primary" },
    { name: "DATABASE_URL", value: "postgres://replica" },
  ]);

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, [
    {
      index: 1,
      message: "Environment variable names must be unique.",
      type: "duplicate-name",
    },
  ]);
});

test("container env rows normalize direct rows and compare by saved shape", () => {
  assert.deepEqual(
    normalizeContainerEnvRowsForSave([
      {
        name: " DATABASE_URL ",
        value: "postgres://db:5432/app",
        valueSource: "direct",
      },
    ]),
    [{ name: "DATABASE_URL", value: "postgres://db:5432/app" }]
  );

  assert.equal(
    containerEnvRowsEqual(
      [{ name: "DATABASE_URL", value: "postgres://db:5432/app" }],
      [
        {
          name: "DATABASE_URL",
          value: "postgres://db:5432/app",
          valueSource: "direct",
        },
      ]
    ),
    true
  );

  assert.equal(
    containerEnvRowsEqual(
      [
        {
          name: "DATABASE_PASSWORD",
          value: "(valueFrom)",
          valueFrom: { secretKeyRef: { key: "password", name: "db" } },
          valueSource: "valueFrom",
        },
      ],
      [
        {
          name: "DATABASE_PASSWORD",
          value: "External reference",
          valueFrom: { secretKeyRef: { key: "password", name: "db" } },
          valueSource: "valueFrom",
        },
      ]
    ),
    true
  );
});

test("container env rows compare primitive DB references by saved Secret ref", () => {
  assert.equal(
    containerEnvRowsEqual(
      [
        {
          dbDsn: {
            dbName: "postgres",
            dbNamespace: "default",
            field: "username",
          },
          name: "DATABASE_FIELD",
          value: "(valueFrom)",
          valueFrom: {
            secretKeyRef: {
              key: "user",
              name: "postgres-conn-credential",
            },
          },
          valueSource: "dbDsn",
        },
      ],
      [
        {
          dbDsn: {
            dbName: "postgres",
            dbNamespace: "default",
            field: "password",
          },
          name: "DATABASE_FIELD",
          value: "(valueFrom)",
          valueFrom: {
            secretKeyRef: {
              key: "passwd",
              name: "postgres-conn-credential",
            },
          },
          valueSource: "dbDsn",
        },
      ]
    ),
    false
  );
});

test("container env rows model comparison preserves editor reference rows", () => {
  const direct = [{ name: "DATABASE_URL", value: "postgres://private" }];
  const reference = [
    {
      dbDsn: {
        dbName: "postgres",
        dbNamespace: "default",
        field: "private" as const,
      },
      name: "DATABASE_URL",
      value: "postgres://private",
      valueSource: "dbDsn" as const,
    },
  ];

  assert.equal(containerEnvRowsEqual(direct, reference), true);
  assert.equal(containerEnvRowsModelEqual(direct, reference), false);
  assert.equal(
    containerEnvRowsModelEqual(direct, [
      {
        name: "DATABASE_URL",
        value: "postgres://private",
        valueSource: "direct",
      },
    ]),
    true
  );
});

test("container env rows add DB DSN references with private DSN as the default field", () => {
  const dbs = [
    {
      name: "postgres",
      namespace: "default",
      privateDsn: "postgres://private",
      publicDsn: "postgres://public",
    },
  ];

  assert.deepEqual(containerEnvDbDsnFieldOptions(dbs[0]), [
    { field: "private", label: "Private DSN", value: "postgres://private" },
    { field: "public", label: "Public DSN", value: "postgres://public" },
  ]);

  const rows = addContainerEnvDbDsnReferenceRow([], dbs);

  assert.deepEqual(rows, [
    {
      dbDsn: {
        dbName: "postgres",
        dbNamespace: "default",
        field: "private",
      },
      name: "DATABASE_URL",
      value: "postgres://private",
      valueSource: "dbDsn",
    },
  ]);
  assert.deepEqual(normalizeContainerEnvRowsForSave(rows), [
    { name: "DATABASE_URL", value: "postgres://private" },
  ]);
});

test("container env rows name DB reference rows by selected field", () => {
  const secretKeyRef = { key: "user", name: "postgres-conn-credential" };

  assert.deepEqual(
    addContainerEnvDbDsnReferenceRow(
      [{ name: "DATABASE_USER", value: "manual" }],
      [
        {
          name: "postgres",
          namespace: "default",
          primitiveSecretRefs: {
            username: secretKeyRef,
          },
        },
      ]
    ),
    [
      { name: "DATABASE_USER", value: "manual" },
      {
        dbDsn: {
          dbName: "postgres",
          dbNamespace: "default",
          field: "username",
        },
        name: "DATABASE_USER_2",
        value: "(valueFrom)",
        valueFrom: { secretKeyRef },
        valueSource: "dbDsn",
      },
    ]
  );
});

test("container env rows omit unavailable public DSNs and cannot add DBs without DSNs", () => {
  assert.deepEqual(
    containerEnvDbDsnFieldOptions({
      name: "private-only",
      namespace: "default",
      privateDsn: "postgres://private",
    }),
    [{ field: "private", label: "Private DSN", value: "postgres://private" }]
  );

  assert.deepEqual(
    addContainerEnvDbDsnReferenceRow(
      [],
      [{ name: "empty", namespace: "default" }]
    ),
    []
  );
});

test("container env rows offer primitive DB fields from Secret key evidence", () => {
  const source = {
    name: "postgres",
    namespace: "default",
    primitiveSecretRefs: {
      host: { key: "endpoint", name: "postgres-conn-credential" },
      password: { key: "passwd", name: "postgres-conn-credential" },
      port: { key: "port", name: "postgres-conn-credential" },
      username: { key: "user", name: "postgres-conn-credential" },
    },
  };

  assert.deepEqual(containerEnvDbDsnFieldOptions(source), [
    {
      field: "username",
      label: "Username",
      valueFrom: {
        secretKeyRef: { key: "user", name: "postgres-conn-credential" },
      },
    },
    {
      field: "password",
      label: "Password",
      valueFrom: {
        secretKeyRef: { key: "passwd", name: "postgres-conn-credential" },
      },
    },
    {
      field: "host",
      label: "Host",
      valueFrom: {
        secretKeyRef: { key: "endpoint", name: "postgres-conn-credential" },
      },
    },
    {
      field: "port",
      label: "Port",
      valueFrom: {
        secretKeyRef: { key: "port", name: "postgres-conn-credential" },
      },
    },
  ]);
});

test("container env rows reconstruct DB DSN references only by exact value equality", () => {
  const sources = [
    {
      name: "postgres",
      namespace: "default",
      privateDsn: "postgres://private",
      publicDsn: "postgres://public",
    },
  ];

  assert.deepEqual(
    containerEnvDbDsnReferenceFromValue("postgres://private", sources),
    {
      dbDsn: {
        dbName: "postgres",
        dbNamespace: "default",
        field: "private",
      },
      value: "postgres://private",
      valueSource: "dbDsn",
    }
  );
  assert.equal(
    containerEnvDbDsnReferenceFromValue("postgres://private ", sources),
    undefined
  );
  assert.equal(
    containerEnvDbDsnReferenceFromValue(
      "postgres://private?looks-like-dsn",
      sources
    ),
    undefined
  );
});
