import { jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type { CancellationReasonKey } from "./reasons";

/**
 * Postgres schema owning Cancellation Survey responses (ADR-0072). A peer of
 * the onboarding and notification schemas, isolated from `public` like every
 * other app-owned schema. The rows are feedback *about* a billing action,
 * never billing state: no code path reads them to decide anything about a
 * Workspace Subscription.
 */
export const CANCELLATION_SURVEY_DB_SCHEMA = "sealai_cancellation_survey";

export const ns = pgSchema(CANCELLATION_SURVEY_DB_SCHEMA);

/**
 * One row per submitted Cancellation Survey, written only after
 * account-service confirmed the cancel. Reason keys are the stable machine
 * values of the closed vocabulary in `./reasons`; the database holds plain
 * JSON. The free text may contain personal details and stays here only —
 * it never travels to analytics. No reader, retention sweep, or secondary
 * index in V1: consumption is by SQL.
 */
export const cancellationSurveyResponses = ns.table(
  "cancellation_survey_responses",
  {
    id: text("id").primaryKey(),
    workspace: text("workspace").notNull(),
    /** Billing Region domain; the database is region-local, so this names the region it lives in. */
    regionDomain: text("region_domain").notNull(),
    planName: text("plan_name").notNull(),
    currentPeriodEndAt: timestamp("current_period_end_at", {
      mode: "date",
      withTimezone: true,
    }),
    /** Bare global user UID of the acting user (ADR-0059): no per-region crName. */
    userUid: text("user_uid").notNull(),
    reasonKeys: jsonb("reason_keys").notNull().$type<CancellationReasonKey[]>(),
    feedback: text("feedback").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

export type CancellationSurveyResponseRow =
  typeof cancellationSurveyResponses.$inferSelect;
