/**
 * Runs once when the Node server starts. Applies pending app-owned Postgres
 * migrations (`apps/ui/drizzle`) before the server takes traffic, then
 * starts the deployment task engine runtime (reaper + shutdown drain,
 * ADR 0037) alongside them.
 *
 * In production a migration failure aborts the boot (a half-migrated schema
 * must not serve traffic). In dev it degrades to a warning so the UI still
 * boots against a broken/unreachable database.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { appTokenVerificationConfigFromEnv, assertProductionAppTokenConfig } =
    await import("@/lib/app-token");
  // ADR-0059: personal-resource authorization must never fall back to a
  // default secret, so a production boot without the config aborts here.
  assertProductionAppTokenConfig();
  const { assertProductionAccountServiceConfig } = await import(
    "@/lib/account-service/config"
  );
  // ADR-0060: a half-configured billing client must never serve traffic.
  assertProductionAccountServiceConfig();
  if (appTokenVerificationConfigFromEnv() == null) {
    console.warn(
      "[instrumentation] JWT_INTERNAL is unset; personal-resource routes will fail closed with 401."
    );
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
    return;
  }
  if (!process.env.DATABASE_URL?.trim()) {
    return;
  }
  try {
    const { startDeployTaskEngine } = await import(
      "@/features/deploy/task/engine/server"
    );
    startDeployTaskEngine();
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    console.warn(
      "[instrumentation] deploy task engine failed to start:",
      error
    );
  }
  try {
    const { startChatDevboxLifecycleRuntime } = await import(
      "@/features/chat/devbox/lifecycle"
    );
    startChatDevboxLifecycleRuntime();
  } catch (error) {
    if (process.env.NODE_ENV === "production") {
      throw error;
    }
    console.warn(
      "[instrumentation] chat Devbox lifecycle failed to start:",
      error
    );
  }
}
