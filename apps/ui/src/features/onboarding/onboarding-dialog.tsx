"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppInput } from "@workspace/ui/components/app-input";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowRight, Check, Send } from "lucide-react";
import { type ReactNode, useEffect, useReducer, useRef } from "react";

import { trackBrainGtmEvent } from "@/features/analytics/brain-gtm";

import {
  canAdvanceOnboardingStep,
  createInitialOnboardingSurveyState,
  type OnboardingSurveyState,
  onboardingCompletePayload,
  onboardingPriorityAnswerPayload,
  onboardingRoleAnswerPayload,
  onboardingSkipEvent,
  onboardingSkipPayload,
  onboardingStepViewEvent,
  onboardingSurveyReducer,
  onboardingUsageAnswerPayload,
} from "./survey-state";
import {
  type AnswerOnboardingStepRequest,
  type CompleteOnboardingProfileRequest,
  ONBOARDING_PRIORITY_TAGS_MAX,
  ONBOARDING_SURVEY_TOTAL_STEPS,
  type OnboardingPriorityTag,
  type OnboardingRoleType,
  type OnboardingUsageContext,
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

const USAGE_OPTIONS: readonly {
  label: string;
  value: OnboardingUsageContext;
}[] = [
  { label: "Just exploring Sealos", value: "exploring" },
  { label: "Testing a demo or prototype", value: "demo_or_prototype" },
  { label: "Shipping an AI-built app", value: "ai_built_app" },
  { label: "Building a side project", value: "side_project" },
  { label: "Launching a new product", value: "new_product_launch" },
  { label: "Running a real business project", value: "real_business" },
  { label: "Supporting a team or client project", value: "team_or_client" },
  { label: "Other", value: "other" },
];

/**
 * Step 3 copy keyed by Cohort Tag: the cards render in the session's
 * shuffled display order, so the copy cannot live in an ordered list.
 */
const PRIORITY_OPTIONS: Record<
  OnboardingPriorityTag,
  { description?: string; label: string }
> = {
  ease_of_use: {
    description: "I want minimal configuration & zero DevOps.",
    label: "Ease of use",
  },
  fast_launch: {
    description: "I just want to get a live URL as quickly as possible.",
    label: "Fast launch",
  },
  low_cost: {
    description: "I am highly sensitive to pricing & resource efficiency.",
    label: "Low cost",
  },
  other: { label: "Other" },
  performance: {
    description: "I need maximum speed & computational power.",
    label: "Performance",
  },
  scalability: {
    description: "I need an architecture that grows with my user base.",
    label: "Scalability",
  },
  stability: {
    description: "I need a highly reliable environment for a real business.",
    label: "Stability",
  },
};

function OptionCard({
  children,
  disabled = false,
  onToggle,
  selected,
}: {
  children: ReactNode;
  disabled?: boolean;
  onToggle: () => void;
  selected: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        // min-h, not h: the Step 3 descriptions must stay readable, so a
        // card grows and wraps rather than truncating its one-liner.
        "flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-2 text-left text-sm transition-colors",
        selected
          ? "border-brand-primary bg-input/50 text-foreground"
          : "border-transparent bg-input/30 text-foreground hover:bg-input/50",
        disabled && "cursor-not-allowed opacity-50 hover:bg-input/30"
      )}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      <span className="min-w-0">{children}</span>
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
}

function StepHeading({
  head,
  subtitle,
  tail,
}: {
  head: string;
  subtitle?: string;
  tail: string;
}) {
  return (
    <>
      <h2 className="mt-12 font-bold text-3xl text-foreground">
        {head} <span className="text-brand-primary">{tail}</span>
      </h2>
      {subtitle == null ? null : (
        <p className="mt-2 text-muted-foreground text-sm">{subtitle}</p>
      )}
    </>
  );
}

export interface OnboardingSurveyCardProps {
  /**
   * Fired once per step at the moment Next advances, with that step's answer
   * payload. The owner persists it fire-and-forget — advancing never waits.
   */
  onAnswerStep: (payload: AnswerOnboardingStepRequest) => void;
  /**
   * Submit & Enter Console: the terminal completion, carrying the optional
   * Step 4 open goal. The owner closes the dialog and persists.
   */
  onComplete: (payload: CompleteOnboardingProfileRequest) => void;
  /** Skip: the single exit short of the final submit; the owner persists. */
  onSkip: (payload: { dismissedAtStep: number }) => void;
}

function stepAnswerPayload(
  state: OnboardingSurveyState
): AnswerOnboardingStepRequest | null {
  switch (state.currentStep) {
    case 1:
      return onboardingRoleAnswerPayload(state);
    case 2:
      return onboardingUsageAnswerPayload(state);
    case 3:
      return onboardingPriorityAnswerPayload(state);
    default:
      return null;
  }
}

/**
 * The survey frame: all interactive content of the sampling dialog, kept
 * free of the dialog primitive so behavior is testable in a plain DOM.
 */
export function OnboardingSurveyCard({
  onAnswerStep,
  onComplete,
  onSkip,
}: OnboardingSurveyCardProps) {
  const [state, dispatch] = useReducer(
    onboardingSurveyReducer,
    undefined,
    // The card mounts when the dialog opens, so the lazy initializer is the
    // once-per-session seat of the Step 3 display-order shuffle.
    () => createInitialOnboardingSurveyState()
  );

  // The funnel view events: one per step shown, the mount itself being the
  // dialog's appearance (step 1). With no back navigation the step only
  // grows, so the monotonic ref guard means exactly once per step — a
  // dev-mode remount replaying the effect cannot double-fire.
  const lastViewedStepRef = useRef(0);
  useEffect(() => {
    if (lastViewedStepRef.current >= state.currentStep) {
      return;
    }
    lastViewedStepRef.current = state.currentStep;
    const viewEvent = onboardingStepViewEvent(state.currentStep);
    if (viewEvent !== null) {
      trackBrainGtmEvent(viewEvent);
    }
  }, [state.currentStep]);

  const handleNext = () => {
    // Persist-then-advance, both synchronous from the click: the payload is
    // assembled from the state being left, and the write is the owner's
    // fire-and-forget concern — Next never blocks on it.
    const payload = stepAnswerPayload(state);
    if (payload != null) {
      onAnswerStep(payload);
    }
    dispatch({ type: "advance-step" });
  };

  const handleSkip = () => {
    // The funnel event fires at click time, before the owner's terminal
    // write — analytics is best-effort and never awaits persistence.
    const skipEvent = onboardingSkipEvent(state.currentStep);
    if (skipEvent !== null) {
      trackBrainGtmEvent(skipEvent);
    }
    onSkip(onboardingSkipPayload(state));
  };

  const handleComplete = () => {
    trackBrainGtmEvent({ event: "onboarding_complete" });
    onComplete(onboardingCompletePayload(state));
  };

  return (
    <div className="flex min-h-144 flex-col p-9">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-sm">
          Step {state.currentStep} of {ONBOARDING_SURVEY_TOTAL_STEPS}
        </span>
        <button
          className="text-muted-foreground text-sm transition-colors hover:text-foreground"
          onClick={handleSkip}
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
          <StepHeading
            head="Tell us"
            subtitle="This helps us tailor your workspace experience."
            tail="a bit about you."
          />
          <fieldset className="mt-9 grid gap-4 border-0 sm:grid-cols-2">
            <legend className="sr-only">Your role</legend>
            {ROLE_OPTIONS.map((option) => (
              <OptionCard
                key={option.value}
                onToggle={() =>
                  dispatch({ role: option.value, type: "toggle-role" })
                }
                selected={state.roleType === option.value}
              >
                {option.label}
              </OptionCard>
            ))}
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
      ) : null}
      {state.currentStep === 2 ? (
        <>
          <StepHeading
            head="What are"
            subtitle="Let us know what stage your project is in."
            tail="you using Sealos for?"
          />
          <fieldset className="mt-9 grid gap-4 border-0 sm:grid-cols-2">
            <legend className="sr-only">Your usage context</legend>
            {USAGE_OPTIONS.map((option) => (
              <OptionCard
                key={option.value}
                onToggle={() =>
                  dispatch({ type: "toggle-usage", usage: option.value })
                }
                selected={state.usageContext === option.value}
              >
                {option.label}
              </OptionCard>
            ))}
            {state.usageContext === "other" ? (
              <AppInput
                aria-label="Describe your usage"
                onChange={(event) =>
                  dispatch({
                    text: event.target.value,
                    type: "set-usage-other-text",
                  })
                }
                placeholder="Tell us more (optional)"
                value={state.usageOtherText}
              />
            ) : null}
          </fieldset>
        </>
      ) : null}
      {state.currentStep === 3 ? (
        <>
          <StepHeading
            head="Which factors are"
            subtitle="Choose up to 3."
            tail="most important to you?"
          />
          <fieldset className="mt-9 grid gap-4 border-0 sm:grid-cols-2">
            <legend className="sr-only">Your top priorities</legend>
            {state.priorityDisplayOrder.map((tag) => {
              const option = PRIORITY_OPTIONS[tag];
              const selected = state.priorityTags.includes(tag);
              return (
                <OptionCard
                  // Multi-select capped at 3: at the cap, unpicked options
                  // lock until a slot reopens (the reducer refuses anyway).
                  disabled={
                    !selected &&
                    state.priorityTags.length >= ONBOARDING_PRIORITY_TAGS_MAX
                  }
                  key={tag}
                  onToggle={() => dispatch({ tag, type: "toggle-priority" })}
                  selected={selected}
                >
                  {option.label}
                  {option.description == null ? null : (
                    <span className="text-muted-foreground">
                      {" — "}
                      {option.description}
                    </span>
                  )}
                </OptionCard>
              );
            })}
            {state.priorityTags.includes("other") ? (
              <AppInput
                aria-label="Describe your priority"
                onChange={(event) =>
                  dispatch({
                    text: event.target.value,
                    type: "set-priority-other-text",
                  })
                }
                placeholder="Tell us more (optional)"
                value={state.priorityOtherText}
              />
            ) : null}
          </fieldset>
        </>
      ) : null}
      {state.currentStep === 4 ? (
        <>
          <StepHeading
            head="Anything specific"
            tail="you're trying to achieve?"
          />
          <AppInput
            aria-label="Anything specific you're trying to achieve?"
            className="mt-9"
            onChange={(event) =>
              dispatch({
                text: event.target.value,
                type: "set-open-goal-text",
              })
            }
            placeholder="e.g. deploy an AI agent, move from VPS, test a product idea…"
            value={state.openGoalText}
          />
        </>
      ) : null}
      <div className="mt-auto flex justify-end pt-9">
        {state.currentStep === ONBOARDING_SURVEY_TOTAL_STEPS ? (
          // The terminal submit: never gated (the open goal is optional) and
          // never awaited — the owner closes the dialog into the console.
          <AppButton onClick={handleComplete} type="button">
            Submit & Enter Console
            <Send aria-hidden data-icon="inline-end" />
          </AppButton>
        ) : (
          // No auto-advance: the explicit Next unlocks with the current
          // step's answer and persists it fire-and-forget on the way.
          <AppButton
            disabled={!canAdvanceOnboardingStep(state)}
            onClick={handleNext}
            type="button"
          >
            Next
            <ArrowRight aria-hidden data-icon="inline-end" />
          </AppButton>
        )}
      </div>
    </div>
  );
}

/**
 * Non-dismissible by design (spec): `open` is fully controlled by the Gate
 * and this handler ignores every close request — escape-key and
 * outside-press included — so the weakened Skip link and the final submit
 * are the only exits.
 */
export function refuseOnboardingDialogClose(): void {
  // Controlled `open` never flips here.
}

export interface OnboardingDialogProps extends OnboardingSurveyCardProps {
  open: boolean;
}

/**
 * The sampling dialog (spec: first-entry user-understanding survey): the
 * full-size modal shell around the survey frame. Hook-free so structural
 * tests can walk the element tree without rendering the dialog primitive.
 */
export function OnboardingDialog({
  onAnswerStep,
  onComplete,
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
        <OnboardingSurveyCard
          onAnswerStep={onAnswerStep}
          onComplete={onComplete}
          onSkip={onSkip}
        />
      </AppDialog.Content>
    </AppDialog.Root>
  );
}
