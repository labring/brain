import { existsSync } from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/**
 * Cross-replica mutex for boot-time migrations. Two int32 halves ("SEAL",
 * "MIGR"); replicas booting concurrently apply migrations one at a time.
 */
const MIGRATION_LOCK_KEY: readonly [number, number] = [
  0x53_45_41_4c, 0x4d_49_47_52,
];

function resolveMigrationsFolder(): string {
  const candidates = [
    // `next dev` / `next start` run with `apps/ui` as cwd.
    path.join(process.cwd(), "drizzle"),
    // Docker standalone runner: WORKDIR /app, server at apps/ui/server.js.
    path.join(process.cwd(), "apps", "ui", "drizzle"),
  ];
  const found = candidates.find((dir) =>
    existsSync(path.join(dir, "meta", "_journal.json"))
  );
  if (found === undefined) {
    throw new Error(
      `App Postgres migrations folder not found (looked in: ${candidates.join(", ")}). The drizzle/ folder must ship alongside the server.`
    );
  }
  return found;
}

/**
 * Applies pending SQL migrations from `apps/ui/drizzle` (journaled in
 * `drizzle.__drizzle_migrations`). This is the only mechanism that provisions
 * app-owned Postgres state — there are no runtime CREATE TABLE fallbacks.
 *
 * No `DATABASE_URL` → skipped, so builds and DB-less dev setups still boot.
 * `APP_POSTGRES_SKIP_MIGRATIONS=1` → skipped, for deployments that point at a
 * database owned by another release (demo/preview envs sharing the main app's
 * Postgres) where this build must never apply DDL. The schema then may not
 * match this build; persistence-backed features can fail at runtime.
 * A failure is rethrown to the caller (instrumentation fails the boot in
 * production rather than serving with a half-migrated schema).
 */
export async function runAppPostgresMigrations(): Promise<void> {
  const skip = process.env.APP_POSTGRES_SKIP_MIGRATIONS?.trim().toLowerCase();
  if (skip === "1" || skip === "true") {
    console.warn(
      "[app-postgres] APP_POSTGRES_SKIP_MIGRATIONS is set; skipping schema migrations. The database schema may not match this build."
    );
    return;
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.warn(
      "[app-postgres] DATABASE_URL is not set; skipping schema migrations. Persistence-backed features will fail until it is configured."
    );
    return;
  }

  const migrationsFolder = resolveMigrationsFolder();
  // max: 1 pins every query to one session so the session-level advisory lock
  // is held across the whole migration run.
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("select pg_advisory_lock($1, $2)", [
      ...MIGRATION_LOCK_KEY,
    ]);
    try {
      await migrate(drizzle(pool), { migrationsFolder });
    } finally {
      await pool
        .query("select pg_advisory_unlock($1, $2)", [...MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
  } finally {
    await pool.end();
  }
}
