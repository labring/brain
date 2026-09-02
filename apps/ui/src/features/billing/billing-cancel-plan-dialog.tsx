"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import {
  AppLengthHint,
  AppOptionCard,
} from "@workspace/ui/components/app-option-card";
import { AppTextarea } from "@workspace/ui/components/app-textarea";
import { CircleCheck } from "lucide-react";
import { useId, useRef, useState } from "react";

import { trackBrainGtmEvent } from "@/features/analytics/brain-gtm";
import {
  CANCEL_PLAN_PREVIEW_PENDING_MS,
  type CancelPlanDialogPreviewStage,
  useCancelPlanDialogPreview,
} from "@/features/billing/billing-cancel-plan-dialog-tweaks";
import type { SubscriptionLifecycleHandler } from "@/features/billing/billing-plan-data";
import {
  CANCELLATION_FEEDBACK_MAX_LENGTH,
  CANCELLATION_REASONS,
  type CancellationReasonKey,
  type CancellationSurveyAnswers,
  cancellationSurveyHasAnswers,
  EMPTY_CANCELLATION_SURVEY_ANSWERS,
} from "@/features/billing/cancellation-survey/reasons";

type CancelPlanDialogStage = CancelPlanDialogPreviewStage;

const PREVIEW_FAILURE_MESSAGE = "Preview: the cancel was refused.";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CancelPlanDialogProps {
  disabled: boolean;
  /**
   * Whether the Cancel Plan trigger is offered. The dialog itself is mounted
   * regardless: a successful cancel flips the Plan lifecycle to cancelling,
   * which withdraws the trigger, and the confirmation stage must outlive
   * that refresh.
   */
  offerTrigger: boolean;
  onConfirm?: SubscriptionLifecycleHandler;
  /** The current period end, already formatted for display. */
  periodEndLabel: string;
  planName: string;
}

/**
 * The Plan view's cancel dialog, grown into the Cancellation Survey
 * (CONTEXT.md, ADR-0072). Two stages in one dialog: the survey — the
 * period-end warning, optional reason cards, optional feedback — and, after
 * account-service confirmed the cancel, an in-place confirmation. The survey
 * never gates the cancel: an empty submission cancels the same, and every
 * way out of the survey stage is Keep Plan.
 */
export function CancelPlanDialog({
  disabled,
  offerTrigger,
  onConfirm,
  periodEndLabel,
  planName,
}: CancelPlanDialogProps) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<CancelPlanDialogStage>("survey");
  const [answers, setAnswers] = useState<CancellationSurveyAnswers>(
    EMPTY_CANCELLATION_SURVEY_ANSWERS
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A preview is opened from the dev tweaks panel and never leaves the page:
  // Cancel Plan settles locally, and no dismissal reports a keep.
  const [previewing, setPreviewing] = useState(false);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const feedbackId = useId();

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) {
      return;
    }
    if (nextOpen) {
      // A fresh survey every time: cancel, resume, cancel again each carry
      // their own reasons.
      setStage("survey");
      setAnswers(EMPTY_CANCELLATION_SURVEY_ANSWERS);
      setError(null);
    } else if (previewing) {
      setPreviewing(false);
    } else if (stage === "survey") {
      // Keep Plan and every dismissal path (Escape, overlay) mean the same
      // thing; leaving the confirmation stage is not a keep.
      trackBrainGtmEvent({
        event: "subscription_cancel_kept",
        plan_name: planName,
      });
    }
    setOpen(nextOpen);
  };

  const preview = useCancelPlanDialogPreview((previewStage) => {
    if (submitting) {
      return;
    }
    setPreviewing(true);
    setStage(previewStage);
    setAnswers(EMPTY_CANCELLATION_SURVEY_ANSWERS);
    setError(null);
    setOpen(true);
  });

  const toggleReason = (key: CancellationReasonKey) => {
    const selected = answers.reasons.includes(key);
    const reasons = selected
      ? answers.reasons.filter((reason) => reason !== key)
      : [...answers.reasons, key];
    setAnswers((current) => ({ ...current, reasons }));
    if (key === "other" && !selected) {
      feedbackRef.current?.focus();
    }
  };

  const confirmCancellation = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (previewing) {
        await wait(CANCEL_PLAN_PREVIEW_PENDING_MS);
        if (preview.simulateFailure) {
          setError(PREVIEW_FAILURE_MESSAGE);
          return;
        }
        setStage("confirmation");
        return;
      }
      const outcome = await onConfirm?.("canceled", {
        survey: { feedback: answers.feedback.trim(), reasons: answers.reasons },
      });
      if (outcome != null && !outcome.ok) {
        setError(outcome.message);
        return;
      }
      setStage("confirmation");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppDialog.Root onOpenChange={handleOpenChange} open={open}>
      {offerTrigger ? (
        <AppDialog.Trigger
          disabled={disabled}
          id="billing-cancel-subscription-trigger"
          render={<AppButton variant="secondary" />}
        >
          Cancel Plan
        </AppDialog.Trigger>
      ) : null}
      {/* Carries the survey-surface material, like the Onboarding survey.
          The survey needs the width for its two-column reason grid; the
          confirmation is a short notice and drops back to the default. */}
      <AppDialog.Content
        className="survey-surface"
        size={stage === "confirmation" ? "default" : "lg"}
      >
        {stage === "confirmation" ? (
          <>
            <AppDialog.Header>
              <AppDialog.Icon className="text-emerald-400">
                <CircleCheck aria-hidden />
              </AppDialog.Icon>
              <AppDialog.Title>Cancellation scheduled</AppDialog.Title>
              <AppDialog.Description className="sr-only">
                The plan stays active until the current period ends and can be
                resumed before then from the Plan view.
              </AppDialog.Description>
            </AppDialog.Header>
            <AppDialog.Body>
              <p className="text-muted-foreground">
                Your{" "}
                <span className="font-medium text-foreground">{planName}</span>{" "}
                plan stays active until{" "}
                <span className="font-medium text-foreground">
                  {periodEndLabel}
                </span>
                . You can resume it anytime before then from the Plan view.
              </p>
              {cancellationSurveyHasAnswers(answers) ||
              (previewing && preview.withFeedback) ? (
                <p className="text-muted-foreground">
                  Thank you for your feedback — it helps us improve.
                </p>
              ) : null}
            </AppDialog.Body>
            <AppDialog.Footer>
              <AppDialog.Cancel>Close</AppDialog.Cancel>
            </AppDialog.Footer>
          </>
        ) : (
          <>
            <AppDialog.Header>
              <AppDialog.WarningIcon className="text-destructive" />
              <AppDialog.Title>We are sorry to see you go</AppDialog.Title>
              <AppDialog.Description className="sr-only">
                Cancelling keeps the plan until the current period ends, after
                which the workspace is suspended and its resources deleted soon
                after.
              </AppDialog.Description>
            </AppDialog.Header>
            <AppDialog.Body>
              <p className="text-muted-foreground">
                Your resources will be kept until the current subscription
                period ends (
                <span className="font-medium text-destructive">
                  {periodEndLabel}
                </span>
                ).{" "}
                <span className="font-medium text-destructive">
                  After that, your workspace will be suspended and its resources
                  deleted soon after
                </span>
                . Please backup your work in advance to avoid data loss.
              </p>
              {/* min-w-0: a fieldset's default min-content width would let
                  the longest reason label force the dialog wider. */}
              <fieldset className="min-w-0">
                <legend className="mb-2 font-medium text-foreground">
                  Before you go, what made you cancel? Select all that apply.
                </legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {CANCELLATION_REASONS.map((reason) => (
                    <AppOptionCard
                      disabled={submitting}
                      key={reason.key}
                      onToggle={() => toggleReason(reason.key)}
                      selected={answers.reasons.includes(reason.key)}
                      semantics="checkbox"
                      shape="checkbox"
                    >
                      {reason.label}
                    </AppOptionCard>
                  ))}
                </div>
              </fieldset>
              <AppDialog.Field>
                <AppDialog.Label htmlFor={feedbackId}>
                  Additional feedback (optional)
                </AppDialog.Label>
                <AppTextarea
                  className="min-h-20"
                  disabled={submitting}
                  id={feedbackId}
                  maxLength={CANCELLATION_FEEDBACK_MAX_LENGTH}
                  onChange={(event) => {
                    const feedback = event.target.value;
                    setAnswers((current) => ({ ...current, feedback }));
                  }}
                  placeholder="Tell us more about your experience…"
                  ref={feedbackRef}
                  rows={3}
                  value={answers.feedback}
                />
                <AppLengthHint
                  aria-live="polite"
                  className="self-end"
                  max={CANCELLATION_FEEDBACK_MAX_LENGTH}
                  value={answers.feedback}
                />
              </AppDialog.Field>
              {error == null ? null : (
                <p className="text-destructive" role="alert">
                  {error}
                </p>
              )}
            </AppDialog.Body>
            <AppDialog.Footer>
              <AppDialog.Cancel disabled={submitting}>
                Keep Plan
              </AppDialog.Cancel>
              <AppDialog.DestructiveAction
                loading={submitting}
                loadingLabel="Cancelling..."
                onClick={confirmCancellation}
              >
                Cancel Plan
              </AppDialog.DestructiveAction>
            </AppDialog.Footer>
          </>
        )}
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
