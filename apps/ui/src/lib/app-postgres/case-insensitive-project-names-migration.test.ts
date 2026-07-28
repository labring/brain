import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const DUPLICATE_KEY_RE = /duplicate key value/;

const migrationPath = fileURLToPath(
  new URL(
    "../../../drizzle/0007_case_insensitive_project_display_names.sql",
    import.meta.url
  )
);

/** The `sealai_project.projects` shape this migration inherits at journal 0006. */
async function seedProjects(db: PGlite, rows: string): Promise<void> {
  await db.exec(`
    CREATE SCHEMA "sealai_project";
    CREATE TABLE "sealai_project"."projects" (
      "namespace" text NOT NULL,
      "id" text NOT NULL,
      "display_name" text NOT NULL,
      "description" text DEFAULT '' NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "projects_pk" PRIMARY KEY ("namespace", "id")
    );
    CREATE UNIQUE INDEX "projects_namespace_display_name_idx"
      ON "sealai_project"."projects" ("namespace", "display_name");
    INSERT INTO "sealai_project"."projects" ("namespace", "id", "display_name", "created_at") VALUES ${rows};
  `);
}

async function applyMigration(db: PGlite): Promise<void> {
  const migration = await readFile(migrationPath, "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim() !== "") {
      await db.exec(statement);
    }
  }
}

async function projectNames(
  db: PGlite,
  namespace: string
): Promise<{ display_name: string; id: string }[]> {
  const result = await db.query<{ display_name: string; id: string }>(
    'SELECT "id", "display_name" FROM "sealai_project"."projects" WHERE "namespace" = $1 ORDER BY "id"',
    [namespace]
  );
  return result.rows;
}

test("migration de-duplicates case-variant names, keeping the earliest Project's", async () => {
  const db = new PGlite();
  try {
    await seedProjects(
      db,
      `
      ('ns-a', 'p-1', 'nginx', '2024-01-01T00:00:00Z'),
      ('ns-a', 'p-2', 'Nginx', '2024-01-02T00:00:00Z'),
      ('ns-a', 'p-3', 'NGINX', '2024-01-03T00:00:00Z'),
      ('ns-a', 'p-4', 'nginx-2', '2024-01-04T00:00:00Z'),
      ('ns-b', 'p-5', 'Nginx', '2024-01-05T00:00:00Z')
    `
    );

    await applyMigration(db);

    assert.deepEqual(await projectNames(db, "ns-a"), [
      { display_name: "nginx", id: "p-1" },
      // The taken `nginx-2` is skipped rather than collided with.
      { display_name: "Nginx-3", id: "p-2" },
      { display_name: "NGINX-4", id: "p-3" },
      { display_name: "nginx-2", id: "p-4" },
    ]);
    // Uniqueness is namespace-scoped: a name shared across namespaces stands.
    assert.deepEqual(await projectNames(db, "ns-b"), [
      { display_name: "Nginx", id: "p-5" },
    ]);
  } finally {
    await db.close();
  }
});

test("migration leaves already-unique names untouched", async () => {
  const db = new PGlite();
  try {
    await seedProjects(
      db,
      `
      ('ns-a', 'p-1', 'swift-orbit', '2024-01-01T00:00:00Z'),
      ('ns-a', 'p-2', 'My-API', '2024-01-02T00:00:00Z')
    `
    );

    await applyMigration(db);

    assert.deepEqual(await projectNames(db, "ns-a"), [
      { display_name: "swift-orbit", id: "p-1" },
      { display_name: "My-API", id: "p-2" },
    ]);
  } finally {
    await db.close();
  }
});

test("migrated index rejects case-variant names and the old one is gone", async () => {
  const db = new PGlite();
  try {
    await seedProjects(db, "('ns-a', 'p-1', 'nginx', '2024-01-01T00:00:00Z')");

    await applyMigration(db);

    const indexes = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'sealai_project' AND tablename = 'projects'"
    );
    const indexNames = indexes.rows.map((row) => row.indexname);
    assert.ok(indexNames.includes("projects_namespace_lower_display_name_idx"));
    assert.equal(
      indexNames.includes("projects_namespace_display_name_idx"),
      false
    );

    await assert.rejects(
      db.exec(
        `INSERT INTO "sealai_project"."projects" ("namespace", "id", "display_name") VALUES ('ns-a', 'p-2', 'NGINX')`
      ),
      DUPLICATE_KEY_RE
    );
    // A different namespace keeps the same name available.
    await db.exec(
      `INSERT INTO "sealai_project"."projects" ("namespace", "id", "display_name") VALUES ('ns-b', 'p-3', 'NGINX')`
    );
  } finally {
    await db.close();
  }
});
