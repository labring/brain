import "server-only";

import { eq } from "drizzle-orm";

import { normalizePinnedProjectIds } from "@/lib/pinned-projects";

import { getProjectDb } from "./db";
import {
  type ProjectNavigationPreferencesRow,
  projectNavigationPreferences,
} from "./schema";
import { ensureProjectStorageSchema } from "./schema-bootstrap";

export interface ProjectNavigationPreferences {
  namespace: string;
  pinnedProjectIds: string[];
  updatedAt: string | null;
}

export interface UpdateProjectNavigationPreferencesInput {
  namespace: string;
  pinnedProjectIds: readonly string[];
}

function rowToPreferences(
  row: ProjectNavigationPreferencesRow
): ProjectNavigationPreferences {
  return {
    namespace: row.namespace,
    pinnedProjectIds: normalizePinnedProjectIds(row.pinnedProjectIds),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getProjectNavigationPreferences(
  namespace: string
): Promise<ProjectNavigationPreferences> {
  await ensureProjectStorageSchema();
  const [row] = await getProjectDb()
    .select()
    .from(projectNavigationPreferences)
    .where(eq(projectNavigationPreferences.namespace, namespace))
    .limit(1);

  return row === undefined
    ? { namespace, pinnedProjectIds: [], updatedAt: null }
    : rowToPreferences(row);
}

export async function updateProjectNavigationPreferences(
  input: UpdateProjectNavigationPreferencesInput
): Promise<ProjectNavigationPreferences> {
  await ensureProjectStorageSchema();
  const now = new Date();
  const pinnedProjectIds = normalizePinnedProjectIds(input.pinnedProjectIds);
  const [row] = await getProjectDb()
    .insert(projectNavigationPreferences)
    .values({
      createdAt: now,
      namespace: input.namespace,
      pinnedProjectIds,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: {
        pinnedProjectIds,
        updatedAt: now,
      },
      target: projectNavigationPreferences.namespace,
    })
    .returning();

  if (row === undefined) {
    return { namespace: input.namespace, pinnedProjectIds, updatedAt: null };
  }
  return rowToPreferences(row);
}
