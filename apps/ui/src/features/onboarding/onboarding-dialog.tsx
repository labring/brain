"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppInput } from "@workspace/ui/components/app-input";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowRight, Check } from "lucide-react";
import { useReducer } from "react";

import {
  canAdvanceOnboardingStep,
  initialOnboardingSurveyState,
  onboardingRoleAnswerPayload,
  onboardingSkipPayload,
  onboardingSurveyReducer,
} from "./survey-state";
import {
  type AnswerOnboardingStepRequest,
  ONBOARDING_SURVEY_TOTAL_STEPS,
  type OnboardingRoleType,
} from "./types";

const ROLE_OPTIONS: readonly { label: string; value: OnboardingRoleType }[] = [
  { label: "Individual developer", value: "individual_developer" },
  { label: "Startup founder / Indie hacker", value: "founder" },
  { label: "Engineering team member", value: "engineering_team_member" },
  { label: "DevOps / Platform engineer", value: "devops_platform_engineer" },
  { label: "AI-assisted builder / Vibe coder", value: "ai_builder" },
  { label: "Student / Learner", value: "student" },
  { label: "Other", value: "other" },
];

export interface OnboardingSurveyCardProps {
  /**
   * Fired once per step at the moment Next advances, with that step's answer
   * payload. The owner persists it fire-and-forget — advancing never waits.
   */
  onAnswerStep: (payload: AnswerOnboardingStepRequest) => void;
  /** Skip: the single exit short of the final submit; the owner persists. */
  onSkip: (payload: { dismissedAtStep: number }) => void;
}

/**
 * The survey frame: all interactive content of the sampling dialog, kept
 * free of the dialog primitive so behavior is testable in a plain DOM.
 * Step 1 is the real role question; Step 2 is still a placeholder.
 */
export function OnboardingSurveyCard({
  onAnswerStep,
  onSkip,
}: OnboardingSurveyCardProps) {
  const [state, dispatch] = useReducer(
    onboardingSurveyReducer,
    initialOnboardingSurveyState
  );

  const handleNext = () => {
    // Persist-then-advance, both synchronous from the click: the payload is
    // assembled from the state being left, and the write is the owner's
    // fire-and-forget concern — Next never blocks on it.
    const payload =
      state.currentStep === 1 ? onboardingRoleAnswerPayload(state) : null;
    if (payload != null) {
      onAnswerStep(payload);
    }
    dispatch({ type: "advance-step" });
  };

  return (
    <div className="flex min-h-144 flex-col p-9">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">
          Step {state.currentStep} of {ONBOARDING_SURVEY_TOTAL_STEPS}
        </span>
        <button
          className="text-muted-foreground text-sm transition-colors hover:text-foreground"
          onClick={() => onSkip(onboardingSkipPayload(state))}
          type="button"
        >
          Skip
        </button>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-3">
        {Array.from({ length: ONBOARDING_SURVEY_TOTAL_STEPS }, (_, index) => (
          <div
            className={cn(
              "h-1 rounded-full",
              index < state.currentStep ? "bg-brand-primary" : "bg-muted"
            )}
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size ordinal track
            key={index}
          />
        ))}
      </div>
      {/* Plain headings: the dialog context is optional for the card so the
          frame stays testable in a plain DOM; the shell labels the dialog. */}
      {state.currentStep === 1 ? (
        <>
          <h2 className="mt-12 font-bold text-3xl text-foreground">
            Tell us <span className="text-brand-primary">a bit about you.</span>
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            This helps us tailor your workspace experience.
          </p>
          <fieldset className="mt-9 grid gap-4 border-0 sm:grid-cols-2">
            <legend className="sr-only">Your role</legend>
            {ROLE_OPTIONS.map((option) => {
              const selected = state.roleType === option.value;
              return (
                <button
                  aria-pressed={selected}
                  className={cn(
                    "flex h-12 items-center justify-between gap-3 rounded-lg border px-4 text-left text-sm transition-colors",
                    selected
                      ? "border-brand-primary bg-input/50 text-foreground"
                      : "border-transparent bg-input/30 text-foreground hover:bg-input/50"
                  )}
                  key={option.value}
                  onClick={() =>
                    dispatch({ role: option.value, type: "toggle-role" })
                  }
                  type="button"
                >
                  <span className="truncate">{option.label}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-xs border",
                      selected
                        ? "border-brand-primary bg-brand-primary text-brand-primary-foreground"
                        : "border-brand-primary/60"
                    )}
                  >
                    {selected ? <Check className="size-3" /> : null}
                  </span>
                </button>
              );
            })}
            {state.roleType === "other" ? (
              <AppInput
                aria-label="Describe your role"
                onChange={(event) =>
                  dispatch({
                    text: event.target.value,
                    type: "set-role-other-text",
                  })
                }
                placeholder="Tell us more (optional)"
                value={state.roleOtherText}
              />
            ) : null}
          </fieldset>
        </>
      ) : (
        // Step 2 placeholder: the usage-context question lands in the next
        // ticket; until then the gate stays closed and Skip is the way on.
        <p className="mt-12 text-muted-foreground text-sm">
          The next question is on its way.
        </p>
      )}
      <div className="mt-auto flex justify-end pt-9">
        {/* No auto-advance: the explicit Next unlocks with the current
            step's answer and persists it fire-and-forget on the way. */}
        <AppButton
          disabled={!canAdvanceOnboardingStep(state)}
          onClick={handleNext}
          type="button"
        >
          Next
          <ArrowRight aria-hidden data-icon="inline-end" />
        </AppButton>
      </div>
    </div>
  );
}

/**
 * Non-dismissible by design (spec): `open` is fully controlled by the Gate
 * and this handler ignores every close request — escape-key and
 * outside-press included — so the weakened Skip link is the only exit until
 * the final submit exists.
 */
export function refuseOnboardingDialogClose(): void {
  // Controlled `open` never flips here.
}

export interface OnboardingDialogProps extends OnboardingSurveyCardProps {
  open: boolean;
}

/**
 * The sampling dialog (spec: first-entry user-understanding survey): the
 * full-size modal shell around the Step 1 frame. Hook-free so structural
 * tests can walk the element tree without rendering the dialog primitive.
 */
export function OnboardingDialog({
  onAnswerStep,
  onSkip,
  open,
}: OnboardingDialogProps) {
  return (
    <AppDialog.Root onOpenChange={refuseOnboardingDialogClose} open={open}>
      <AppDialog.Content
        aria-label="Onboarding survey"
        overlayClassName="bg-black/60"
        size="xl"
      >
        <OnboardingSurveyCard onAnswerStep={onAnswerStep} onSkip={onSkip} />
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
