import { z } from "zod";

/**
 * The Cancellation Reason vocabulary (CONTEXT.md "Cancellation Reason",
 * ADR-0074): stable machine keys shared by the survey chips, the server's
 * request schema, and the analytics event type. Keys are load-bearing —
 * renaming one after launch means a data migration — while the display text
 * is presentation only and may be reworded freely.
 */
export const cancellationReasonKeySchema = z.enum([
  "low_usage",
  "too_expensive",
  "no_longer_needed",
  "missing_feature",
  "better_alternative",
  "reliability",
  "too_complex",
  "other",
]);

export type CancellationReasonKey = z.infer<typeof cancellationReasonKeySchema>;

/** Chip order in the survey; `other` stays last and hands focus to the text box. */
export const CANCELLATION_REASONS: readonly {
  key: CancellationReasonKey;
  label: string;
}[] = [
  { key: "low_usage", label: "I don't use it often enough" },
  { key: "too_expensive", label: "The cost is too high" },
  {
    key: "no_longer_needed",
    label: "I no longer need it (project ended or moved)",
  },
  { key: "missing_feature", label: "It's missing a feature I need" },
  { key: "better_alternative", label: "I found a better alternative" },
  {
    key: "reliability",
    label: "I ran into reliability or performance issues",
  },
  { key: "too_complex", label: "It's too complicated to use" },
  { key: "other", label: "Other" },
];

/** Hard maximum of the free-text feedback after trimming. */
export const CANCELLATION_FEEDBACK_MAX_LENGTH = 500;

/** What the survey collects: every answer optional, both may be empty. */
export interface CancellationSurveyAnswers {
  feedback: string;
  reasons: CancellationReasonKey[];
}

export const EMPTY_CANCELLATION_SURVEY_ANSWERS: CancellationSurveyAnswers = {
  feedback: "",
  reasons: [],
};

/** Whether the person said anything at all — drives the thank-you line. */
export function cancellationSurveyHasAnswers(
  answers: CancellationSurveyAnswers
): boolean {
  return answers.reasons.length > 0 || answers.feedback.trim() !== "";
}

/**
 * The survey write's request boundary. Unknown keys, duplicate keys,
 * over-length text, and blank workspace or region are rejected; the reason
 * list and the text may both be empty — an unanswered survey still lands as
 * a row so the response rate is computable from the table alone.
 */
export const cancellationSurveyRequestSchema = z.object({
  currentPeriodEndAt: z.iso.datetime({ offset: true }).nullable(),
  feedback: z.string().trim().max(CANCELLATION_FEEDBACK_MAX_LENGTH),
  planName: z.string().trim().min(1),
  reasons: z
    .array(cancellationReasonKeySchema)
    .refine((keys) => new Set(keys).size === keys.length, {
      message: "Cancellation reasons must be unique.",
    }),
  regionDomain: z.string().trim().min(1),
  workspace: z.string().trim().min(1),
});
