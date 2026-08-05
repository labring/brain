import { z } from "zod";

import type { OnboardingProfileStatus, OnboardingRoleType } from "./schema";

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

/** Sane length bound for every optional Other free text (spec #88). */
export const ONBOARDING_OTHER_TEXT_MAX_LENGTH = 500;

const onboardingOtherTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(ONBOARDING_OTHER_TEXT_MAX_LENGTH)
  .nullable();

/**
 * The stepwise answer write: one step's answer fields, upserted with
 * `status: in_progress` at the moment the person advances. A discriminated
 * union on `step` — later steps add members without changing the surface.
 * Other is always a pair: free text may only travel with the `other` tag.
 */
export const answerOnboardingStepRequestSchema = z
  .discriminatedUnion("step", [
    z.object({
      roleOtherText: onboardingOtherTextSchema,
      roleType: onboardingRoleTypeSchema,
      step: z.literal(1),
    }),
  ])
  .superRefine((value, ctx) => {
    if (
      value.step === 1 &&
      value.roleType !== "other" &&
      value.roleOtherText !== null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Other text requires the `other` tag.",
        path: ["roleOtherText"],
      });
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
