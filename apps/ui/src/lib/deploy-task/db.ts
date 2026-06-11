import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { getAppPostgresPool } from "@/lib/app-postgres/db";

import { deployTaskEvents, deployTaskMessages, deployTasks } from "./schema";

const deploymentTaskSchema = {
  deployTaskEvents,
  deployTaskMessages,
  deployTasks,
};

export type DeploymentTaskPgDatabase = NodePgDatabase<
  typeof deploymentTaskSchema
>;

let deploymentTaskDbInstance: DeploymentTaskPgDatabase | undefined;

/**
 * Lazily creates the Drizzle client on first use so `next build` does not need
 * `DATABASE_URL` during route collection.
 */
export function getDeploymentTaskDb(): DeploymentTaskPgDatabase {
  deploymentTaskDbInstance ??= drizzle(getAppPostgresPool(), {
    schema: deploymentTaskSchema,
  });
  return deploymentTaskDbInstance;
}
