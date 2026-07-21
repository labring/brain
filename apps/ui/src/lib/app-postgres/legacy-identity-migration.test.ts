import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const migrationPath = fileURLToPath(
  new URL("../../../drizzle/0010_retire_legacy_identity.sql", import.meta.url)
);

test("legacy identity migration clears personal records without deleting deployment history", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE SCHEMA "sealai_assistant";
      CREATE SCHEMA "sealai_deployment";
      CREATE TABLE "sealai_assistant"."assistant_chats" ("id" text PRIMARY KEY);
      CREATE TABLE "sealai_assistant"."assistant_chat_messages" (
        "id" text PRIMARY KEY,
        "chat_id" text NOT NULL REFERENCES "sealai_assistant"."assistant_chats" ("id") ON DELETE CASCADE
      );
      CREATE TABLE "sealai_assistant"."github_connections" ("id" text PRIMARY KEY);
      CREATE TABLE "sealai_assistant"."github_oauth_connections" (
        "id" text PRIMARY KEY,
        "user_id" text NOT NULL,
        "access_token_ciphertext" text NOT NULL
      );
      CREATE TABLE "sealai_assistant"."github_app_install_sessions" (
        "state" text PRIMARY KEY,
        "user_id" text NOT NULL
      );
      CREATE TABLE "sealai_deployment"."deploy_tasks" (
        "id" text PRIMARY KEY,
        "credential_binding" jsonb
      );

      INSERT INTO "sealai_assistant"."assistant_chats" VALUES ('chat-legacy');
      INSERT INTO "sealai_assistant"."assistant_chat_messages" VALUES ('message-legacy', 'chat-legacy');
      INSERT INTO "sealai_assistant"."github_connections" VALUES ('app-legacy');
      INSERT INTO "sealai_assistant"."github_oauth_connections" VALUES ('oauth-legacy', 'desktop-user', 'ciphertext');
      INSERT INTO "sealai_assistant"."github_app_install_sessions" VALUES ('state-legacy', 'desktop-user');
      INSERT INTO "sealai_deployment"."deploy_tasks" VALUES (
        'task-historical',
        '{"connectionRef":"oauth-legacy","credentialOwner":"alice-cr","version":1}'::jsonb
      );
    `);

    const migration = await readFile(migrationPath, "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      if (statement.trim() !== "") {
        await db.exec(statement);
      }
    }

    for (const table of [
      "assistant_chats",
      "assistant_chat_messages",
      "github_connections",
      "github_oauth_connections",
      "github_app_install_sessions",
    ]) {
      const result = await db.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "sealai_assistant"."${table}"`
      );
      assert.equal(result.rows[0]?.count, 0, table);
    }

    const tasks = await db.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM "sealai_deployment"."deploy_tasks"'
    );
    assert.equal(tasks.rows[0]?.count, 1);

    const legacyColumns = await db.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'sealai_assistant'
        AND table_name IN ('github_oauth_connections', 'github_app_install_sessions')
        AND column_name = 'user_id'
    `);
    assert.deepEqual(legacyColumns.rows, []);
  } finally {
    await db.close();
  }
});
