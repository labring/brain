import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { getAppPostgresPool } from "@/lib/app-postgres/db";

import { projectCanvasLayouts, projects } from "./schema";

const projectSchema = {
  projectCanvasLayouts,
  projects,
};

export type ProjectPgDatabase = NodePgDatabase<typeof projectSchema>;

let projectDbInstance: ProjectPgDatabase | undefined;

/**
 * Lazily creates the Drizzle client on first use so `next build` does not need
 * `DATABASE_URL` (static analysis / route collection must not open the pool).
 */
export function getProjectDb(): ProjectPgDatabase {
  projectDbInstance ??= drizzle(getAppPostgresPool(), {
    schema: projectSchema,
  });
  return projectDbInstance;
}
