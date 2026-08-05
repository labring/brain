import { z } from "zod";

import type {
  OnboardingPriorityTag,
  OnboardingProfileStatus,
  OnboardingRoleType,
  OnboardingUsageContext,
} from "./schema";

export type {
  OnboardingPriorityTag,
  OnboardingProfileRow,
  OnboardingProfileStatus,
  OnboardingRoleType,
  OnboardingUsageContext,
} from "./schema";

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

/** Step 1 Cohort Tags as the zod boundary (stable machine values, ADR-0061). */
export const onboardingRoleTypeSchema = z.enum([
  "ai_builder",
  "devops_platform_engineer",
  "engineering_team_member",
  "founder",
  "individual_developer",
  "other",
  "student",
] as const satisfies readonly OnboardingRoleType[]);

/** Step 2 Cohort Tags as the zod boundary (stable machine values, ADR-0061). */
export const onboardingUsageContextSchema = z.enum([
  "ai_built_app",
  "demo_or_prototype",
  "exploring",
  "new_product_launch",
  "other",
  "real_business",
  "side_project",
  "team_or_client",
] as const satisfies readonly OnboardingUsageContext[]);

/** Step 3 Cohort Tags as the zod boundary (stable machine values, ADR-0061). */
export const onboardingPriorityTagSchema = z.enum([
  "ease_of_use",
  "fast_launch",
  "low_cost",
  "other",
  "performance",
  "scalability",
  "stability",
] as const satisfies readonly OnboardingPriorityTag[]);

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

export const dismissOnboardingProfileRequestSchema = z.object({
  dismissedAtStep: onboardingSurveyStepSchema,
});

/**
 * The terminal complete write ("Submit & Enter Console"). It carries the
 * Step 4 open goal because submit is that step's only advance — a separate
 * fire-and-forget step write could land after the terminal one and lose the
 * text to terminal-wins. The text is optional: `null` submits cleanly.
 */
export const completeOnboardingProfileRequestSchema = z.object({
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
