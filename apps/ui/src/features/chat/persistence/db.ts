import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { getAppPostgresPool } from "@/lib/app-postgres/db";

import {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
} from "./schema";

const assistantSchema = {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
  identityFingerprints,
};

export type AssistantPgDatabase = PgDatabase<
  PgQueryResultHKT,
  typeof assistantSchema
>;

export type AssistantPgTransaction = Parameters<
  Parameters<AssistantPgDatabase["transaction"]>[0]
>[0];

let assistantDbInstance: AssistantPgDatabase | undefined;

/**
 * Lazily creates the Drizzle client on first use so `next build` does not need
 * `DATABASE_URL` (static analysis / route collection must not open the pool).
 */
export function getAssistantDb(): AssistantPgDatabase {
  assistantDbInstance ??= drizzle(getAppPostgresPool(), {
    schema: assistantSchema,
  }) as AssistantPgDatabase;
  return assistantDbInstance;
}
