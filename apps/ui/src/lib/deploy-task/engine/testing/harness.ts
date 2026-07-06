import path from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import {
  deployTaskEvents,
  deployTaskMessages,
  deployTasks,
} from "../../schema";
import type { DeployTaskNotifyTransport } from "../notify";
import {
  DEPLOY_TASK_NOTIFY_CHANNEL,
  parseDeployTaskNotifyMessage,
} from "../notify";

const deploymentTaskSchema = {
  deployTaskEvents,
  deployTaskMessages,
  deployTasks,
};

export type DeployTaskTestDb = ReturnType<
  typeof drizzle<typeof deploymentTaskSchema>
>;

export interface DeployTaskTestHarness {
  close: () => Promise<void>;
  db: DeployTaskTestDb;
  notify: DeployTaskNotifyTransport;
  pglite: PGlite;
}

function migrationsFolder(): string {
  // src/lib/deploy-task/engine/testing → apps/ui
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../../drizzle"
  );
}

/**
 * PGlite-backed test database applying the real drizzle migrations, plus a
 * notify transport speaking the same channel/payload contract as production
 * through PGlite's listen API.
 */
export async function createDeployTaskTestHarness(): Promise<DeployTaskTestHarness> {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema: deploymentTaskSchema });
  await migrate(db, { migrationsFolder: migrationsFolder() });

  const notify: DeployTaskNotifyTransport = {
    async publish(message) {
      await pglite.query("select pg_notify($1, $2)", [
        DEPLOY_TASK_NOTIFY_CHANNEL,
        JSON.stringify(message),
      ]);
    },
    async subscribe(listener) {
      const unsubscribe = await pglite.listen(
        DEPLOY_TASK_NOTIFY_CHANNEL,
        (payload) => {
          const parsed = parseDeployTaskNotifyMessage(payload);
          if (parsed != null) {
            listener(parsed);
          }
        }
      );
      return unsubscribe;
    },
  };

  return {
    close: () => pglite.close(),
    db: db as DeployTaskTestDb,
    notify,
    pglite,
  };
}
