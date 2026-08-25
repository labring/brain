import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { identityFingerprints } from "@/features/chat/persistence/schema";
import {
  marketingAttributionSubjects,
  marketingLifecycleEvents,
} from "@/features/marketing/schema";
import { getAppPostgresPool } from "@/lib/app-postgres/db";
import {
  deployTaskAgentCalls,
  deployTaskEvents,
  deployTaskMessages,
  deployTasks,
} from "./schema";

const deploymentTaskSchema = {
  deployTaskAgentCalls,
  deployTaskEvents,
  deployTaskMessages,
  deployTasks,
  identityFingerprints,
  marketingAttributionSubjects,
  marketingLifecycleEvents,
};

export type { DeploymentTaskPgDatabase } from "./db-types";

type DeploymentTaskNodePgDatabase = NodePgDatabase<typeof deploymentTaskSchema>;

let deploymentTaskDbInstance: DeploymentTaskNodePgDatabase | undefined;

/**
 * Lazily creates the Drizzle client on first use so `next build` does not need
 * `DATABASE_URL` during route collection.
 */
export function getDeploymentTaskDb(): DeploymentTaskNodePgDatabase {
  deploymentTaskDbInstance ??= drizzle(getAppPostgresPool(), {
    schema: deploymentTaskSchema,
  });
  return deploymentTaskDbInstance;
}
