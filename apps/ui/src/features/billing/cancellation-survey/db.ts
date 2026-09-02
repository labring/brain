import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";

import { getAppPostgresPool } from "@/lib/app-postgres/db";

import { cancellationSurveyResponses } from "./schema";
import type {
  CancellationSurveyDbSchema,
  CancellationSurveyPgDatabase,
} from "./store";

const cancellationSurveySchema: CancellationSurveyDbSchema = {
  cancellationSurveyResponses,
};

let cancellationSurveyDbInstance: CancellationSurveyPgDatabase | undefined;

/**
 * Lazily creates the Drizzle client on first use so `next build` does not need
 * `DATABASE_URL` (static analysis / route collection must not open the pool).
 */
export function getCancellationSurveyDb(): CancellationSurveyPgDatabase {
  cancellationSurveyDbInstance ??= drizzle(getAppPostgresPool(), {
    schema: cancellationSurveySchema,
  }) as CancellationSurveyPgDatabase;
  return cancellationSurveyDbInstance;
}
