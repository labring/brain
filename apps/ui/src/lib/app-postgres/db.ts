import "server-only";

import { Pool } from "pg";

const POOL_MAX = 15;
const POOL_IDLE_MS = 30_000;
const POOL_CONN_TIMEOUT_MS = 5000;

const globalForPg = globalThis as unknown as { appPostgresPool?: Pool };

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required for app Postgres persistence. Add DATABASE_URL (Postgres URL) to apps/ui/.env or apps/ui/.env.local and restart the dev server; migrations apply automatically at startup."
    );
  }
  return url;
}

export function getAppPostgresPool(): Pool {
  if (globalForPg.appPostgresPool) {
    return globalForPg.appPostgresPool;
  }
  const pool = new Pool({
    connectionString: requireDatabaseUrl(),
    max: POOL_MAX,
    idleTimeoutMillis: POOL_IDLE_MS,
    connectionTimeoutMillis: POOL_CONN_TIMEOUT_MS,
  });
  globalForPg.appPostgresPool = pool;
  return pool;
}
