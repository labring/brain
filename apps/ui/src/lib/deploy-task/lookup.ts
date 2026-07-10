import { and, eq } from "drizzle-orm";

import type { DeploymentTaskPgDatabase } from "./db-types";
import type { DeployTaskRow } from "./schema";
import { deployTasks } from "./schema";

/**
 * Authorization-safe task lookup: an unknown ID and a row owned by another
 * namespace are intentionally indistinguishable to the caller.
 */
export async function getDeployTaskRowInNamespace(
  db: DeploymentTaskPgDatabase,
  input: { namespace: string; taskId: string }
): Promise<DeployTaskRow | null> {
  const [task] = await db
    .select()
    .from(deployTasks)
    .where(
      and(
        eq(deployTasks.id, input.taskId),
        eq(deployTasks.namespace, input.namespace.trim())
      )
    )
    .limit(1);
  return task ?? null;
}
