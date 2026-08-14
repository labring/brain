import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { identityFingerprints } from "@/features/chat/persistence/schema";
import type {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "@/features/marketing/schema";
import type {
  deployTaskEvents,
  deployTaskMessages,
  deployTasks,
} from "./schema";

// biome-ignore lint/style/useConsistentTypeDefinitions: interfaces lack the implicit index signature PgDatabase's schema generic requires
export type DeploymentTaskDbSchema = {
  deployTaskEvents: typeof deployTaskEvents;
  deployTaskMessages: typeof deployTaskMessages;
  deployTasks: typeof deployTasks;
  identityFingerprints: typeof identityFingerprints;
  marketingAttributionSubjects: typeof marketingAttributionSubjects;
  marketingLifecycleEvents: typeof marketingLifecycleEvents;
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
