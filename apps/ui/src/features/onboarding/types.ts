import { z } from "zod";

import type { OnboardingProfileStatus } from "./schema";

export type { OnboardingProfileRow, OnboardingProfileStatus } from "./schema";

/** The sampling dialog is a 4-step survey; Skip records the step it was on. */
export const ONBOARDING_SURVEY_TOTAL_STEPS = 4;

export const onboardingSurveyStepSchema = z
  .number()
  .int()
  .min(1)
  .max(ONBOARDING_SURVEY_TOTAL_STEPS);

/**
 * The sampling predicate's whole response (ADR-0061): `sampled: true` when a
 * terminal profile row exists. Nothing else is exposed — the client never
 * needs the stored answers.
 */
export const onboardingSamplingVerdictSchema = z.object({
  sampled: z.boolean(),
});

export type OnboardingSamplingVerdict = z.infer<
  typeof onboardingSamplingVerdictSchema
>;

/**
 * Step 1 Cohort Tags (stable machine values, ADR-0061). The zod enum is the
 * single source of each vocabulary: the row types and the request boundary
 * both derive from it, so a new value cannot land in one and not the other.
 */
export const onboardingRoleTypeSchema = z.enum([
  "ai_builder",
  "devops_platform_engineer",
  "engineering_team_member",
  "founder",
  "individual_developer",
  "other",
  "student",
]);

export type OnboardingRoleType = z.infer<typeof onboardingRoleTypeSchema>;

/** Step 2 Cohort Tags (stable machine values, ADR-0061). */
export const onboardingUsageContextSchema = z.enum([
  "ai_built_app",
  "demo_or_prototype",
  "exploring",
  "new_product_launch",
  "other",
  "real_business",
  "side_project",
  "team_or_client",
]);

export type OnboardingUsageContext = z.infer<
  typeof onboardingUsageContextSchema
>;

/** Step 3 Cohort Tags (stable machine values, ADR-0061). */
export const onboardingPriorityTagSchema = z.enum([
  "ease_of_use",
  "fast_launch",
  "low_cost",
  "other",
  "performance",
  "scalability",
  "stability",
]);

export type OnboardingPriorityTag = z.infer<typeof onboardingPriorityTagSchema>;

/** Step 3 caps the picks at three (spec #88: "Choose up to 3."). */
export const ONBOARDING_PRIORITY_TAGS_MAX = 3;

/** Sane length bound for every optional Other free text (spec #88). */
export const ONBOARDING_OTHER_TEXT_MAX_LENGTH = 500;

/** Sane length bound for the Step 4 open goal — an answer, not an essay. */
export const ONBOARDING_OPEN_GOAL_TEXT_MAX_LENGTH = 2000;

const onboardingOtherTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(ONBOARDING_OTHER_TEXT_MAX_LENGTH)
  .nullable();

/** Text may only travel with the `other` tag — Other is always a pair. */
function loosePairIssue(ctx: z.RefinementCtx, path: string) {
  ctx.addIssue({
    code: "custom",
    message: "Other text requires the `other` tag.",
    path: [path],
  });
}

/**
 * The stepwise answer write: one step's answer fields, upserted with
 * `status: in_progress` at the moment the person advances. A discriminated
 * union on `step` — Step 4's open goal travels on the terminal complete write
 * instead, because its only advance is the submit itself.
 * Other is always a pair: free text may only travel with the `other` tag.
 */
export const answerOnboardingStepRequestSchema = z
  .discriminatedUnion("step", [
    z.object({
      roleOtherText: onboardingOtherTextSchema,
      roleType: onboardingRoleTypeSchema,
      step: z.literal(1),
    }),
    z.object({
      step: z.literal(2),
      usageContext: onboardingUsageContextSchema,
      usageOtherText: onboardingOtherTextSchema,
    }),
    z.object({
      /**
       * The randomized order the options were shown in that session — all
       * seven tags exactly once, Other always pinned last (spec #88).
       */
      priorityDisplayOrder: z
        .array(onboardingPriorityTagSchema)
        .length(onboardingPriorityTagSchema.options.length),
      priorityOtherText: onboardingOtherTextSchema,
      /** 1-3 distinct tags; array order = click order. */
      priorityTags: z
        .array(onboardingPriorityTagSchema)
        .min(1)
        .max(ONBOARDING_PRIORITY_TAGS_MAX),
      step: z.literal(3),
    }),
  ])
  .superRefine((value, ctx) => {
    if (
      value.step === 1 &&
      value.roleType !== "other" &&
      value.roleOtherText !== null
    ) {
      loosePairIssue(ctx, "roleOtherText");
    }
    if (
      value.step === 2 &&
      value.usageContext !== "other" &&
      value.usageOtherText !== null
    ) {
      loosePairIssue(ctx, "usageOtherText");
    }
    if (value.step === 3) {
      if (
        !value.priorityTags.includes("other") &&
        value.priorityOtherText !== null
      ) {
        loosePairIssue(ctx, "priorityOtherText");
      }
      if (new Set(value.priorityTags).size !== value.priorityTags.length) {
        ctx.addIssue({
          code: "custom",
          message: "Priority tags must be distinct.",
          path: ["priorityTags"],
        });
      }
      // With length pinned to the vocabulary size, distinctness makes the
      // display order a full permutation; Other must close it.
      if (
        new Set(value.priorityDisplayOrder).size !==
          value.priorityDisplayOrder.length ||
        value.priorityDisplayOrder.at(-1) !== "other"
      ) {
        ctx.addIssue({
          code: "custom",
          message:
            "Display order must show every tag exactly once with `other` last.",
          path: ["priorityDisplayOrder"],
        });
      }
    }
  });

export type AnswerOnboardingStepRequest = z.infer<
  typeof answerOnboardingStepRequestSchema
>;

/**
 * The state a stepwise write settles on: `in_progress` after a live upsert,
 * or the pre-existing terminal status when terminal-wins made it a no-op.
 */
export interface OnboardingProfileWriteState {
  status: OnboardingProfileStatus;
}

/**
 * The Terminal Snapshot: the answers of every step the session confirmed
 * (advanced past with Next), carried on the terminal write itself. The
 * stepwise writes are fire-and-forget and may silently fail, so the terminal
 * write cannot rely on them having landed — a Sampled row must be complete
 * on the strength of this one request. Steps absent from the snapshot are
 * left untouched by the store, so an earlier session's persisted partials
 * survive a snapshot that never re-answered them.
 */
export const onboardingAnswersSnapshotSchema = z
  .array(answerOnboardingStepRequestSchema)
  .max(ONBOARDING_SURVEY_TOTAL_STEPS - 1)
  .superRefine((answers, ctx) => {
    if (new Set(answers.map((answer) => answer.step)).size !== answers.length) {
      ctx.addIssue({
        code: "custom",
        message: "Snapshot steps must be distinct.",
      });
    }
  });

export type OnboardingAnswersSnapshot = z.infer<
  typeof onboardingAnswersSnapshotSchema
>;

export const dismissOnboardingProfileRequestSchema = z.object({
  // Defaulted for one deploy's grace: a terminal write from a client built
  // before the snapshot existed lands as an empty snapshot — exactly the
  // pre-snapshot behavior — instead of being refused. The inferred request
  // type still requires it, so no current client can forget it.
  answers: onboardingAnswersSnapshotSchema.default([]),
  dismissedAtStep: onboardingSurveyStepSchema,
});

/**
 * The terminal complete write ("Submit & Enter Console"): the Terminal
 * Snapshot plus the Step 4 open goal, which travels here because submit is
 * that step's only advance. The text is optional: `null` submits cleanly.
 */
export const completeOnboardingProfileRequestSchema = z.object({
  // Same one-deploy grace as dismiss: absent means an empty snapshot.
  answers: onboardingAnswersSnapshotSchema.default([]),
  openGoalText: z
    .string()
    .trim()
    .min(1)
    .max(ONBOARDING_OPEN_GOAL_TEXT_MAX_LENGTH)
    .nullable(),
});

export type CompleteOnboardingProfileRequest = z.infer<
  typeof completeOnboardingProfileRequestSchema
>;

export type DismissOnboardingProfileRequest = z.infer<
  typeof dismissOnboardingProfileRequestSchema
>;

/**
 * The state a terminal write settles on. Terminal wins: when the row was
 * already `completed` or `dismissed`, the write is a no-op and this reports
 * the pre-existing state.
 */
export interface OnboardingProfileTerminalState {
  dismissedAtStep: number | null;
  status: "completed" | "dismissed";
}
