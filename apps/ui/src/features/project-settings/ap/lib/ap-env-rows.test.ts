import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addApEnvDbDsnReferenceRow,
  addApEnvRow,
  apEnvDbDsnFieldOptions,
  apEnvDbDsnReferenceFromValue,
  apEnvRowsEqual,
  apEnvRowsModelEqual,
  deleteApEnvRow,
  normalizeApEnvRowsForSave,
  updateApEnvRow,
  validateApEnvRows,
} from "./ap-env-rows";

test("AP env rows add, edit, and delete direct value rows", () => {
  const added = addApEnvRow([]);
  assert.deepEqual(added, [{ name: "NEW_VARIABLE", value: "" }]);

  const edited = updateApEnvRow(added, 0, {
    name: "DATABASE_URL",
    value: "postgres://db:5432/app",
  });
  assert.deepEqual(edited, [
    { name: "DATABASE_URL", value: "postgres://db:5432/app" },
  ]);

  assert.deepEqual(deleteApEnvRow(edited, 0), []);
});

test("AP env rows reject duplicate names", () => {
  const result = validateApEnvRows([
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

test("AP env rows normalize direct rows and compare by saved shape", () => {
  assert.deepEqual(
    normalizeApEnvRowsForSave([
      {
        name: " DATABASE_URL ",
        value: "postgres://db:5432/app",
        valueSource: "direct",
      },
    ]),
    [{ name: "DATABASE_URL", value: "postgres://db:5432/app" }]
  );

  assert.equal(
    apEnvRowsEqual(
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
    apEnvRowsEqual(
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

test("AP env rows compare primitive DB references by saved Secret ref", () => {
  assert.equal(
    apEnvRowsEqual(
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

test("AP env rows model comparison preserves editor reference rows", () => {
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

  assert.equal(apEnvRowsEqual(direct, reference), true);
  assert.equal(apEnvRowsModelEqual(direct, reference), false);
  assert.equal(
    apEnvRowsModelEqual(direct, [
      {
        name: "DATABASE_URL",
        value: "postgres://private",
        valueSource: "direct",
      },
    ]),
    true
  );
});

test("AP env rows add DB DSN references with private DSN as the default field", () => {
  const dbs = [
    {
      name: "postgres",
      namespace: "default",
      privateDsn: "postgres://private",
      publicDsn: "postgres://public",
    },
  ];

  assert.deepEqual(apEnvDbDsnFieldOptions(dbs[0]), [
    { field: "private", label: "Private DSN", value: "postgres://private" },
    { field: "public", label: "Public DSN", value: "postgres://public" },
  ]);

  const rows = addApEnvDbDsnReferenceRow([], dbs);

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
  assert.deepEqual(normalizeApEnvRowsForSave(rows), [
    { name: "DATABASE_URL", value: "postgres://private" },
  ]);
});

test("AP env rows name DB reference rows by selected field", () => {
  const secretKeyRef = { key: "user", name: "postgres-conn-credential" };

  assert.deepEqual(
    addApEnvDbDsnReferenceRow(
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

test("AP env rows omit unavailable public DSNs and cannot add DBs without DSNs", () => {
  assert.deepEqual(
    apEnvDbDsnFieldOptions({
      name: "private-only",
      namespace: "default",
      privateDsn: "postgres://private",
    }),
    [{ field: "private", label: "Private DSN", value: "postgres://private" }]
  );

  assert.deepEqual(
    addApEnvDbDsnReferenceRow([], [{ name: "empty", namespace: "default" }]),
    []
  );
});

test("AP env rows offer primitive DB fields from Secret key evidence", () => {
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

  assert.deepEqual(apEnvDbDsnFieldOptions(source), [
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

test("AP env rows reconstruct DB DSN references only by exact value equality", () => {
  const sources = [
    {
      name: "postgres",
      namespace: "default",
      privateDsn: "postgres://private",
      publicDsn: "postgres://public",
    },
  ];

  assert.deepEqual(
    apEnvDbDsnReferenceFromValue("postgres://private", sources),
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
    apEnvDbDsnReferenceFromValue("postgres://private ", sources),
    undefined
  );
  assert.equal(
    apEnvDbDsnReferenceFromValue("postgres://private?looks-like-dsn", sources),
    undefined
  );
});
