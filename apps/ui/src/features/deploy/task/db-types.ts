import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type {
  deployTaskAgentCalls,
  deployTaskEvents,
  deployTaskMessages,
  deployTasks,
} from "./schema";

// biome-ignore lint/style/useConsistentTypeDefinitions: interfaces lack the implicit index signature PgDatabase's schema generic requires
export type DeploymentTaskDbSchema = {
  deployTaskAgentCalls: typeof deployTaskAgentCalls;
  deployTaskEvents: typeof deployTaskEvents;
  deployTaskMessages: typeof deployTaskMessages;
  deployTasks: typeof deployTasks;
};

/**
 * Driver-agnostic database type shared by production (node-postgres) and the
 * PGlite test harness; the engine constrains itself to the query-builder and
 * `execute` surface every drizzle pg driver provides.
 */
export type DeploymentTaskPgDatabase = PgDatabase<
  PgQueryResultHKT,
  DeploymentTaskDbSchema
>;
