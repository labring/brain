import assert from "node:assert/strict";
import { test } from "node:test";

import type { ContainerEnvDbDsnSource } from "./container-env-rows";
import {
  buildContainerEnvTokenMenuItems,
  containerEnvRowsFromSavedEnv,
  containerEnvValueToEditorTokens,
  containerEnvValueToKubernetesExpansion,
  deleteContainerEnvTokenRow,
  insertContainerEnvTokenText,
  normalizeContainerEnvTokenRowsForSave,
  refreshContainerEnvTokenDraft,
  renameContainerEnvTokenRow,
  updateContainerEnvTokenRow,
} from "./container-env-tokens";

function editorToken(name: string): string {
  return ["$", "{{", name, "}}"].join("");
}

const postgresSource = {
  name: "postgres",
  namespace: "default",
  primitiveSecretRefs: {
    host: { key: "endpoint", name: "postgres-conn-credential" },
    password: { key: "passwd", name: "postgres-conn-credential" },
    port: { key: "port", name: "postgres-conn-credential" },
    username: { key: "user", name: "postgres-conn-credential" },
  },
  privateDsn: "postgres://private",
} satisfies ContainerEnvDbDsnSource;

test("container env tokens convert between editor and Kubernetes expansion syntax", () => {
  assert.equal(
    containerEnvValueToKubernetesExpansion(
      `postgres://${editorToken("PGUSER")}:${editorToken("PGPASSWORD")}@${editorToken("PGHOST")}/app`
    ),
    "postgres://$(PGUSER):$(PGPASSWORD)@$(PGHOST)/app"
  );
  assert.equal(
    containerEnvValueToEditorTokens(
      "postgres://$(PGUSER):$(PGPASSWORD)@$(PGHOST)/app"
    ),
    `postgres://${editorToken("PGUSER")}:${editorToken("PGPASSWORD")}@${editorToken("PGHOST")}/app`
  );
});

test("container env tokens create DB primitive helper rows and save standard env", () => {
  const rows = refreshContainerEnvTokenDraft(
    [
      {
        name: "DATABASE_URL",
        referenceDbKey: "default/postgres",
        value: `postgres://${editorToken("PGUSER")}:${editorToken("PGPASSWORD")}@${editorToken("PGHOST")}:${editorToken("PGPORT")}/app`,
      },
    ],
    [postgresSource]
  ).rows;

  assert.deepEqual(
    rows.map((row) => ({
      helper: row.helper,
      name: row.name,
      value: row.value,
      valueFrom: row.valueFrom,
      valueSource: row.valueSource,
    })),
    [
      {
        helper: undefined,
        name: "DATABASE_URL",
        value: `postgres://${editorToken("PGUSER")}:${editorToken("PGPASSWORD")}@${editorToken("PGHOST")}:${editorToken("PGPORT")}/app`,
        valueFrom: undefined,
        valueSource: undefined,
      },
      {
        helper: {
          automatic: true,
          sourceDbKey: "default/postgres",
          sourceField: "host",
        },
        name: "PGHOST",
        value: "(valueFrom)",
        valueFrom: {
          secretKeyRef: {
            key: "endpoint",
            name: "postgres-conn-credential",
          },
        },
        valueSource: "dbDsn",
      },
      {
        helper: {
          automatic: true,
          sourceDbKey: "default/postgres",
          sourceField: "password",
        },
        name: "PGPASSWORD",
        value: "(valueFrom)",
        valueFrom: {
          secretKeyRef: {
            key: "passwd",
            name: "postgres-conn-credential",
          },
        },
        valueSource: "dbDsn",
      },
      {
        helper: {
          automatic: true,
          sourceDbKey: "default/postgres",
          sourceField: "port",
        },
        name: "PGPORT",
        value: "(valueFrom)",
        valueFrom: {
          secretKeyRef: {
            key: "port",
            name: "postgres-conn-credential",
          },
        },
        valueSource: "dbDsn",
      },
      {
        helper: {
          automatic: true,
          sourceDbKey: "default/postgres",
          sourceField: "username",
        },
        name: "PGUSER",
        value: "(valueFrom)",
        valueFrom: {
          secretKeyRef: {
            key: "user",
            name: "postgres-conn-credential",
          },
        },
        valueSource: "dbDsn",
      },
    ]
  );

  const saved = normalizeContainerEnvTokenRowsForSave(rows, [postgresSource]);

  assert.equal(saved.valid, true);
  assert.deepEqual(saved.env, [
    {
      name: "DATABASE_URL",
      value: "postgres://$(PGUSER):$(PGPASSWORD)@$(PGHOST):$(PGPORT)/app",
    },
    {
      name: "PGHOST",
      value: "(valueFrom)",
      valueFrom: {
        secretKeyRef: {
          key: "endpoint",
          name: "postgres-conn-credential",
        },
      },
      valueSource: "valueFrom",
    },
    {
      name: "PGPASSWORD",
      value: "(valueFrom)",
      valueFrom: {
        secretKeyRef: {
          key: "passwd",
          name: "postgres-conn-credential",
        },
      },
      valueSource: "valueFrom",
    },
    {
      name: "PGPORT",
      value: "(valueFrom)",
      valueFrom: {
        secretKeyRef: {
          key: "port",
          name: "postgres-conn-credential",
        },
      },
      valueSource: "valueFrom",
    },
    {
      name: "PGUSER",
      value: "(valueFrom)",
      valueFrom: {
        secretKeyRef: {
          key: "user",
          name: "postgres-conn-credential",
        },
      },
      valueSource: "valueFrom",
    },
  ]);
});

test("container env tokens clean unused automatic helpers but keep shared helpers", () => {
  const first = refreshContainerEnvTokenDraft(
    [
      {
        name: "DATABASE_URL",
        referenceDbKey: "default/postgres",
        value: editorToken("PGHOST"),
      },
      {
        name: "READ_REPLICA_URL",
        referenceDbKey: "default/postgres",
        value: `tcp://${editorToken("PGHOST")}`,
      },
    ],
    [postgresSource]
  ).rows;

  assert.equal(first.filter((row) => row.name === "PGHOST").length, 1);

  const second = refreshContainerEnvTokenDraft(
    first.map((row) =>
      row.name === "DATABASE_URL" ? { ...row, value: "postgres://manual" } : row
    ),
    [postgresSource]
  ).rows;

  assert.equal(
    second.some((row) => row.name === "PGHOST"),
    true
  );

  const third = refreshContainerEnvTokenDraft(
    second.map((row) =>
      row.name === "READ_REPLICA_URL" ? { ...row, value: "tcp://manual" } : row
    ),
    [postgresSource]
  ).rows;

  assert.equal(
    third.some((row) => row.name === "PGHOST"),
    false
  );
});

test("container env tokens block deleting in-use helper rows", () => {
  const rows = refreshContainerEnvTokenDraft(
    [
      {
        name: "DATABASE_URL",
        referenceDbKey: "default/postgres",
        value: editorToken("PGPASSWORD"),
      },
    ],
    [postgresSource]
  ).rows;
  const helperIndex = rows.findIndex((row) => row.name === "PGPASSWORD");
  const result = deleteContainerEnvTokenRow(rows, helperIndex);

  assert.deepEqual(result.rows, rows);
  assert.deepEqual(result.diagnostic, {
    message: `Remove references to ${editorToken("PGPASSWORD")} before deleting this helper.`,
    rowIndex: helperIndex,
    token: "PGPASSWORD",
    type: "helper-in-use",
  });
});

test("container env token helper rename updates referencing tokens", () => {
  const rows = refreshContainerEnvTokenDraft(
    [
      {
        name: "DATABASE_URL",
        referenceDbKey: "default/postgres",
        value: editorToken("PGPASSWORD"),
      },
    ],
    [postgresSource]
  ).rows;
  const helperIndex = rows.findIndex((row) => row.name === "PGPASSWORD");

  assert.deepEqual(
    renameContainerEnvTokenRow(rows, helperIndex, "DATABASE_PASSWORD").map(
      (row) => ({ name: row.name, value: row.value })
    ),
    [
      { name: "DATABASE_URL", value: editorToken("DATABASE_PASSWORD") },
      { name: "DATABASE_PASSWORD", value: "(valueFrom)" },
    ]
  );
});

test("container env tokens downgrade edited helpers to normal env rows", () => {
  const rows = refreshContainerEnvTokenDraft(
    [
      {
        name: "DATABASE_URL",
        referenceDbKey: "default/postgres",
        value: editorToken("PGPASSWORD"),
      },
    ],
    [postgresSource]
  ).rows;
  const helperIndex = rows.findIndex((row) => row.name === "PGPASSWORD");
  const next = updateContainerEnvTokenRow(rows, helperIndex, {
    value: "manual",
    valueSource: "direct",
  });

  assert.deepEqual(next[helperIndex], {
    name: "PGPASSWORD",
    value: "manual",
    valueFrom: {
      secretKeyRef: {
        key: "passwd",
        name: "postgres-conn-credential",
      },
    },
    valueSource: "direct",
  });
  assert.equal(
    normalizeContainerEnvTokenRowsForSave(next, [postgresSource]).valid,
    true
  );
});

test("container env tokens downgrade edited DB reference rows to normal env rows", () => {
  const next = updateContainerEnvTokenRow(
    [
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
    ],
    0,
    {
      value: "manual",
      valueSource: "direct",
    }
  );

  assert.deepEqual(next, [
    {
      name: "DATABASE_URL",
      value: "manual",
      valueSource: "direct",
    },
  ]);
});

test("container env tokens report unresolved tokens before save", () => {
  const result = normalizeContainerEnvTokenRowsForSave(
    [
      {
        name: "DATABASE_URL",
        value: `postgres://${editorToken("PGPASSWORD")}`,
      },
    ],
    []
  );

  assert.equal(result.valid, false);
  assert.deepEqual(result.diagnostics, [
    {
      message: "Choose a Reference or create PGPASSWORD.",
      rowIndex: 0,
      token: "PGPASSWORD",
      type: "unresolved-token",
    },
  ]);
});

test("container env tokens use fallback DB helper names on conflicts", () => {
  const menuItems = buildContainerEnvTokenMenuItems({
    dbSources: [postgresSource],
    row: {
      name: "DATABASE_URL",
      referenceDbKey: "default/postgres",
      value: "",
    },
    rows: [
      { name: "PGUSER", value: "manual" },
      {
        name: "DATABASE_URL",
        referenceDbKey: "default/postgres",
        value: "",
      },
    ],
  });

  assert.equal(
    menuItems.some((item) => item.token === "POSTGRES_PGUSER"),
    true
  );

  const rows = refreshContainerEnvTokenDraft(
    [
      { name: "PGUSER", value: "manual" },
      {
        name: "DATABASE_URL",
        referenceDbKey: "default/postgres",
        value: editorToken("POSTGRES_PGUSER"),
      },
    ],
    [postgresSource]
  ).rows;

  assert.equal(
    rows.some((row) => row.name === "POSTGRES_PGUSER"),
    true
  );
});

test("container env tokens reconstruct editor tokens from saved env expansion", () => {
  const secretKeyRef = { key: "passwd", name: "postgres-conn-credential" };
  const rows = containerEnvRowsFromSavedEnv(
    [
      {
        name: "DATABASE_URL",
        value: "postgres://$(PGPASSWORD)@db/app",
      },
      {
        dbDsn: {
          dbName: "postgres",
          dbNamespace: "default",
          field: "password",
        },
        name: "PGPASSWORD",
        value: "(valueFrom)",
        valueFrom: { secretKeyRef },
        valueSource: "dbDsn",
      },
    ],
    [postgresSource]
  );

  assert.deepEqual(
    rows.map((row) => ({
      helper: row.helper,
      name: row.name,
      referenceDbKey: row.referenceDbKey,
      value: row.value,
    })),
    [
      {
        helper: undefined,
        name: "DATABASE_URL",
        referenceDbKey: "default/postgres",
        value: `postgres://${editorToken("PGPASSWORD")}@db/app`,
      },
      {
        helper: {
          automatic: false,
          sourceDbKey: "default/postgres",
          sourceField: "password",
        },
        name: "PGPASSWORD",
        referenceDbKey: undefined,
        value: "(valueFrom)",
      },
    ]
  );
});

test("container env token insertion preserves surrounding text", () => {
  assert.equal(
    insertContainerEnvTokenText("postgres://@db/app", "PGUSER", 11, 11),
    `postgres://${editorToken("PGUSER")}@db/app`
  );
});
