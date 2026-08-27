import "server-only";

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { getAppPostgresPool } from "@/lib/app-postgres/db";

import {
  projectCanvasLayouts,
  projectDeleteOperations,
  projectDeletePreviews,
  projectManagementAuditEvents,
  projectNavigationPreferences,
  projects,
  templateInstanceAdoptions,
} from "./schema";

const projectSchema = {
  projectDeleteOperations,
  projectDeletePreviews,
  projectManagementAuditEvents,
  projectCanvasLayouts,
  projectNavigationPreferences,
  projects,
  templateInstanceAdoptions,
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
