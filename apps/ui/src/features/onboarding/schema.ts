import { integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Postgres schema owning the Onboarding Profile (ADR-0061). Isolated from
 * `public` so `drizzle-kit push` with `schemaFilter` does not try to drop
 * operator/managed tables.
 */
export const ONBOARDING_DB_SCHEMA = "sealai_onboarding";

export const ns = pgSchema(ONBOARDING_DB_SCHEMA);

/**
 * `completed` and `dismissed` are terminal — the person is Sampled and the
 * dialog never shows again. `in_progress` (an abandoned mid-survey row) still
 * counts as Unsampled.
 */
export type OnboardingProfileStatus = "completed" | "dismissed" | "in_progress";

/** Step 1 Cohort Tags: who the person is. */
export type OnboardingRoleType =
  | "ai_builder"
  | "devops_platform_engineer"
  | "engineering_team_member"
  | "founder"
  | "individual_developer"
  | "other"
  | "student";

/** Step 2 Cohort Tags: what the person is using Sealos for. */
export type OnboardingUsageContext =
  | "ai_built_app"
  | "demo_or_prototype"
  | "exploring"
  | "new_product_launch"
  | "other"
  | "real_business"
  | "side_project"
  | "team_or_client";

/** Step 3 Cohort Tags: the factors that matter most. */
export type OnboardingPriorityTag =
  | "ease_of_use"
  | "fast_launch"
  | "low_cost"
  | "other"
  | "performance"
  | "scalability"
  | "stability";

/**
 * One Onboarding Profile row per person — Brain's first namespace-less
 * personal resource, keyed by the bare global `userUid` (ADR-0061). The
 * database is region-local, so the practical semantic is one profile per
 * person per region. Unanswered questions are NULL columns; progress is
 * inferred, never stored. Tag columns hold stable machine values validated by
 * zod at the application boundary — the database stores plain text.
 */
export const onboardingProfiles = ns.table("onboarding_profiles", {
  /** Bare global user UID: no namespace, no per-region crName, ever. */
  userUid: text("user_uid").primaryKey(),
  status: text("status").notNull().$type<OnboardingProfileStatus>(),
  /** Step (1–4) the survey was on when Skip was clicked. */
  dismissedAtStep: integer("dismissed_at_step"),
  /** Step 1 answer; literal `other` pairs with `roleOtherText`. */
  roleType: text("role_type").$type<OnboardingRoleType>(),
  /** Step 1 Other free text — optional even when `roleType` is `other`. */
  roleOtherText: text("role_other_text"),
  /** Step 2 answer; literal `other` pairs with `usageOtherText`. */
  usageContext: text("usage_context").$type<OnboardingUsageContext>(),
  /** Step 2 Other free text — optional even when `usageContext` is `other`. */
  usageOtherText: text("usage_other_text"),
  /** Step 3 answer: 1–3 tags; array order = click order. */
  priorityTags: jsonb("priority_tags").$type<OnboardingPriorityTag[]>(),
  /** The randomized option order shown that session, Other pinned last. */
  priorityDisplayOrder: jsonb("priority_display_order").$type<
    OnboardingPriorityTag[]
  >(),
  /** Step 3 Other free text — optional, combinable with other picks. */
  priorityOtherText: text("priority_other_text"),
  /** Step 4 open answer. */
  openGoalText: text("open_goal_text"),
  /** Doubles as the terminal timestamp; no extra column. */
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type OnboardingProfileRow = typeof onboardingProfiles.$inferSelect;
