import assert from "node:assert/strict";
import { test } from "node:test";

import { deriveDatabaseProjectDisplayName } from "./database-project-display-name";

test("Database project display name uses the selected database label", () => {
  assert.equal(
    deriveDatabaseProjectDisplayName({
      choice: {
        engine: "mysql",
        id: "dbs-mysql-kubeblocks",
        label: "MySQL",
      },
      existingProjectDisplayNames: [],
    }),
    "MySQL"
  );
});

test("Database project display name falls back to engine", () => {
  assert.equal(
    deriveDatabaseProjectDisplayName({
      choice: {
        engine: "postgresql",
        id: "dbs-postgresql-kubeblocks",
        label: " ",
      },
      existingProjectDisplayNames: [],
    }),
    "postgresql"
  );
});

test("Database project display name avoids case-insensitive repeated conflicts", () => {
  assert.equal(
    deriveDatabaseProjectDisplayName({
      choice: {
        engine: "mysql",
        id: "dbs-mysql-kubeblocks",
        label: "MySQL",
      },
      existingProjectDisplayNames: ["mysql", "MySQL-2"],
    }),
    "MySQL-3"
  );
});
