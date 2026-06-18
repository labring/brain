import { Pool } from "pg";

import { ASSISTANT_DB_SCHEMA } from "@/lib/chat-persistence/types";
import { DEPLOYMENT_TASK_DB_SCHEMA } from "@/lib/deploy-task/schema";
import { PROJECT_DB_SCHEMA } from "@/lib/project-persistence/types";

/**
 * Runs once when the Node server starts. Ensures app-owned Postgres schemas
 * exist so DDL from `db:push` can target stable qualified names (`<schema>.*`).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    return;
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    for (const schemaName of [
      ASSISTANT_DB_SCHEMA,
      DEPLOYMENT_TASK_DB_SCHEMA,
      PROJECT_DB_SCHEMA,
    ]) {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    }
  } catch (error) {
    console.warn(
      "[instrumentation] skipped app Postgres schema bootstrap:",
      error
    );
  } finally {
    await pool.end();
  }
}
