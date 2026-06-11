import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { getAppPostgresPool } from "@/lib/app-postgres/db";

import {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubConnections,
} from "./schema";

const assistantSchema = {
  assistantChatMessages,
  assistantChats,
  assistantEntitlements,
  githubConnections,
};

export type AssistantPgDatabase = NodePgDatabase<typeof assistantSchema>;

let assistantDbInstance: AssistantPgDatabase | undefined;

/**
 * Lazily creates the Drizzle client on first use so `next build` does not need
 * `DATABASE_URL` (static analysis / route collection must not open the pool).
 */
export function getAssistantDb(): AssistantPgDatabase {
  assistantDbInstance ??= drizzle(getAppPostgresPool(), {
    schema: assistantSchema,
  });
  return assistantDbInstance;
}
