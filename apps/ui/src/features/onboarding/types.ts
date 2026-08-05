import { z } from "zod";

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
