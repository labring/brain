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
} from "./schema";

const assistantSchema = {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubAppInstallSessions,
  githubConnections,
  githubOauthConnections,
};

export type AssistantPgDatabase = PgDatabase<
  PgQueryResultHKT,
  typeof assistantSchema
>;

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
