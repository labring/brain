import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import type { CancellationReasonKey } from "./reasons";
import { cancellationSurveyResponses } from "./schema";

// biome-ignore lint/style/useConsistentTypeDefinitions: interfaces lack the implicit index signature PgDatabase's schema generic requires
export type CancellationSurveyDbSchema = {
  cancellationSurveyResponses: typeof cancellationSurveyResponses;
};

/**
 * Driver-agnostic database type shared by production (node-postgres) and the
 * PGlite tests; the store limits itself to the query-builder surface every
 * drizzle pg driver provides.
 */
export type CancellationSurveyPgDatabase = PgDatabase<
  PgQueryResultHKT,
  CancellationSurveyDbSchema
>;

export interface CancellationSurveyRecordInput {
  currentPeriodEndAt: Date | null;
  feedback: string;
  planName: string;
  reasons: CancellationReasonKey[];
  regionDomain: string;
  /** Bare global user UID of the acting user (ADR-0059). */
  userUid: string;
  workspace: string;
}

export interface CancellationSurveyStore {
  /** Appends one response row; every call is a new row, never an upsert. */
  record(input: CancellationSurveyRecordInput): Promise<{ id: string }>;
}

export function createCancellationSurveyStore(
  getDb: () => CancellationSurveyPgDatabase
): CancellationSurveyStore {
  return {
    record: async (input) => {
      const id = crypto.randomUUID();
      await getDb().insert(cancellationSurveyResponses).values({
        currentPeriodEndAt: input.currentPeriodEndAt,
        feedback: input.feedback,
        id,
        planName: input.planName,
        reasonKeys: input.reasons,
        regionDomain: input.regionDomain,
        userUid: input.userUid,
        workspace: input.workspace,
      });
      return { id };
    },
  };
}
