/**
 * Runs once when the Node server starts. Applies pending app-owned Postgres
 * migrations (`apps/ui/drizzle`) before the server takes traffic.
 *
 * In production a migration failure aborts the boot (a half-migrated schema
 * must not serve traffic). In dev it degrades to a warning so the UI still
 * boots against a broken/unreachable database.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { runAppPostgresMigrations } = await import(
    "@/lib/app-postgres/migrate"
  );
  try {
    await runAppPostgresMigrations();
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    console.warn(
      "[instrumentation] app Postgres migrations failed; persistence-backed features will not work:",
      error
    );
  }
}
