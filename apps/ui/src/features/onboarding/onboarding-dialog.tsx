"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppInput } from "@workspace/ui/components/app-input";
import { cn } from "@workspace/ui/lib/utils";
import { ArrowRight, Check, Send } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { trackBrainGtmEvent } from "@/features/analytics/brain-gtm";

import {
  canAdvanceOnboardingStep,
  createInitialOnboardingSurveyState,
  type OnboardingSurveyState,
  onboardingCompletePayload,
  onboardingOtherTextMissing,
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

/**
 * The selection glyph pairs shape with the step's semantics — a deliberate
 * correction over the design file, which draws squares everywhere: the
 * single-select steps show a round radio dot, the multi-select step a square
 * check. The blue border on the unselected glyph is the design's accent.
 */
function SelectionIndicator({
  selected,
  shape,
}: {
  selected: boolean;
  shape: "checkbox" | "radio";
}) {
  let glyph: ReactNode = null;
  if (selected) {
    glyph =
      shape === "radio" ? (
        <span className="size-1.5 rounded-full bg-white" />
      ) : (
        <Check className="size-3" />
      );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center border border-blue-500",
        shape === "radio" ? "rounded-full" : "rounded-xs",
        selected && "bg-blue-500 text-white"
      )}
    >
      {glyph}
    </span>
  );
}

function OptionCard({
  children,
  disabled = false,
  onToggle,
  selected,
  shape,
}: {
  children: ReactNode;
  disabled?: boolean;
  onToggle: () => void;
  selected: boolean;
  shape: "checkbox" | "radio";
}) {
  return (
    <button
      aria-pressed={selected}
      className={cn(
        // min-h, not h: the Step 3 descriptions must stay readable, so a
        // card grows and wraps rather than truncating its one-liner.
        "flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border border-transparent bg-input/30 px-4 py-2.5 text-left text-foreground text-sm transition-colors hover:border-border",
        disabled && "cursor-not-allowed opacity-50 hover:border-transparent"
      )}
      disabled={disabled}
      onClick={onToggle}
      type="button"
    >
      <span className="min-w-0">{children}</span>
      <SelectionIndicator selected={selected} shape={shape} />
    </button>
  );
}

/**
 * The Other slot after selection (design annotation: clicking Other turns
 * the card into an input in place; an empty Next surfaces the inline
 * required error). The container keeps the card footprint and hosts the
 * free text plus the still-toggleable selection glyph — without that glyph
 * the multi-select step could never release Other's cap slot.
 */
function OtherOptionField({
  error,
  inputRef,
  label,
  onTextChange,
  onUnselect,
  shape,
  text,
}: {
  error: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  label: string;
  onTextChange: (text: string) => void;
  onUnselect: () => void;
  shape: "checkbox" | "radio";
  text: string;
}) {
  // The field only ever mounts because the user just selected Other (no back
  // navigation, no pre-selected initial state), so it claims focus on mount:
  // typing starts without a second click.
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);
  return (
    <>
      <div
        className={cn(
          // A focus-within field wrapper: matches appFieldFocusClass's blue
          // by eye, per the field-state outlier note.
          "flex min-h-12 items-center gap-3 rounded-lg border border-input bg-input/30 px-4 py-2.5 transition-colors",
          error
            ? "border-destructive ring-[1px] ring-destructive/50"
            : "focus-within:border-blue-400 focus-within:ring-[1px] focus-within:ring-blue-400/50"
        )}
        onPointerDown={(event) => {
          // The whole card reads as one input, so its padding focuses the
          // input too; the input itself and the unselect glyph keep their
          // native pointer behavior.
          if (
            !(event.target instanceof Element) ||
            event.target.closest("button, input")
          ) {
            return;
          }
          event.preventDefault();
          const input = inputRef.current;
          if (input) {
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
          }
        }}
      >
        <input
          aria-invalid={error || undefined}
          aria-label={label}
          className="min-w-0 flex-1 bg-transparent text-foreground text-sm outline-none placeholder:text-muted-foreground"
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Tell us more"
          ref={inputRef}
          value={text}
        />
        <button
          aria-label="Unselect Other"
          className="cursor-pointer"
          onClick={onUnselect}
          type="button"
        >
          <SelectionIndicator selected shape={shape} />
        </button>
      </div>
      {error ? (
        <p className="self-center text-destructive text-sm">
          This field is required.
        </p>
      ) : null}
    </>
  );
}

/**
 * The filled track reads as one white→blue ramp: its leading segment carries
 * the gradient, later filled segments hold the solid endpoint color.
 */
function progressSegmentClass(index: number, currentStep: number): string {
  if (index >= currentStep) {
    return "bg-input";
  }
  return index === 0
    ? "bg-linear-to-r/srgb from-foreground to-blue-500"
    : "bg-blue-500";
}

/**
 * One step's heading and inputs travel as a group: the tight gap binds the
 * heading to what it introduces while keeping the step frame compact enough
 * that the options do not end in a large unused gap.
 */
const stepGroupClass = "flex min-h-[20rem] flex-col gap-6";

function StepHeading({
  subtitle,
  title,
}: {
  subtitle?: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {/* w-fit: the ramp spans the text itself, so the last word lands on
          the accent endpoint; /srgb matches Figma's gradient interpolation. */}
      <h2 className="w-fit bg-linear-to-r/srgb from-white to-onboarding-heading-accent bg-clip-text font-semibold text-4xl text-transparent">
        {title}
      </h2>
      {subtitle == null ? null : (
        <p className="text-base text-muted-foreground">{subtitle}</p>
      )}
    </div>
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
  // Armed by a refused Next; the visible error also needs the text to still
  // be missing, so typing or unselecting Other clears it without a reset.
  const [otherErrorArmed, setOtherErrorArmed] = useState(false);
  const otherError = otherErrorArmed && onboardingOtherTextMissing(state);
  // At most one Other field renders at a time, so the steps share one ref;
  // the card holds it to send focus into the field on a refused Next.
  const otherInputRef = useRef<HTMLInputElement>(null);

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
    // Other with no text refuses to advance and surfaces the inline error
    // instead (the reducer's advance gate refuses too); nothing persists.
    if (onboardingOtherTextMissing(state)) {
      setOtherErrorArmed(true);
      // The error message alone would leave the user re-aiming at the field;
      // focus lands in the empty input so typing can start immediately.
      otherInputRef.current?.focus();
      return;
    }
    setOtherErrorArmed(false);
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
    <div className="flex flex-col gap-10 p-9">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-sm">
            Step {state.currentStep} of {ONBOARDING_SURVEY_TOTAL_STEPS}
          </span>
          <button
            className="cursor-pointer text-muted-foreground text-sm transition-colors hover:text-foreground"
            onClick={handleSkip}
            type="button"
          >
            Skip
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {Array.from({ length: ONBOARDING_SURVEY_TOTAL_STEPS }, (_, index) => (
            <div
              className={cn(
                "h-2 rounded-full",
                progressSegmentClass(index, state.currentStep)
              )}
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed-size ordinal track
              key={index}
            />
          ))}
        </div>
      </div>
      {/* Plain headings: the dialog context is optional for the card so the
          frame stays testable in a plain DOM; the shell labels the dialog. */}
      {state.currentStep === 1 ? (
        <div className={stepGroupClass}>
          <StepHeading
            subtitle="This helps us tailor your workspace experience."
            title="Tell us a bit about you."
          />
          <fieldset className="grid gap-x-3 gap-y-3 border-0 sm:grid-cols-2">
            <legend className="sr-only">Your role</legend>
            {ROLE_OPTIONS.map((option) =>
              option.value === "other" && state.roleType === "other" ? (
                <OtherOptionField
                  error={otherError}
                  inputRef={otherInputRef}
                  key={option.value}
                  label="Describe your role"
                  onTextChange={(text) =>
                    dispatch({ text, type: "set-role-other-text" })
                  }
                  onUnselect={() =>
                    dispatch({ role: "other", type: "toggle-role" })
                  }
                  shape="radio"
                  text={state.roleOtherText}
                />
              ) : (
                <OptionCard
                  key={option.value}
                  onToggle={() =>
                    dispatch({ role: option.value, type: "toggle-role" })
                  }
                  selected={state.roleType === option.value}
                  shape="radio"
                >
                  {option.label}
                </OptionCard>
              )
            )}
          </fieldset>
        </div>
      ) : null}
      {state.currentStep === 2 ? (
        <div className={stepGroupClass}>
          <StepHeading
            subtitle="Let us know what stage your project is in."
            title="What are you using Sealos for?"
          />
          <fieldset className="grid gap-x-3 gap-y-3 border-0 sm:grid-cols-2">
            <legend className="sr-only">Your usage context</legend>
            {USAGE_OPTIONS.map((option) =>
              option.value === "other" && state.usageContext === "other" ? (
                <OtherOptionField
                  error={otherError}
                  inputRef={otherInputRef}
                  key={option.value}
                  label="Describe your usage"
                  onTextChange={(text) =>
                    dispatch({ text, type: "set-usage-other-text" })
                  }
                  onUnselect={() =>
                    dispatch({ type: "toggle-usage", usage: "other" })
                  }
                  shape="radio"
                  text={state.usageOtherText}
                />
              ) : (
                <OptionCard
                  key={option.value}
                  onToggle={() =>
                    dispatch({ type: "toggle-usage", usage: option.value })
                  }
                  selected={state.usageContext === option.value}
                  shape="radio"
                >
                  {option.label}
                </OptionCard>
              )
            )}
          </fieldset>
        </div>
      ) : null}
      {state.currentStep === 3 ? (
        <div className={stepGroupClass}>
          <StepHeading
            subtitle="Choose up to 3."
            title="Which factors are most important to you?"
          />
          <fieldset className="grid gap-x-3 gap-y-3 border-0 sm:grid-cols-2">
            <legend className="sr-only">Your top priorities</legend>
            {state.priorityDisplayOrder.map((tag) => {
              if (tag === "other" && state.priorityTags.includes("other")) {
                return (
                  <OtherOptionField
                    error={otherError}
                    inputRef={otherInputRef}
                    key={tag}
                    label="Describe your priority"
                    onTextChange={(text) =>
                      dispatch({ text, type: "set-priority-other-text" })
                    }
                    onUnselect={() =>
                      dispatch({ tag: "other", type: "toggle-priority" })
                    }
                    shape="checkbox"
                    text={state.priorityOtherText}
                  />
                );
              }
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
                  shape="checkbox"
                >
                  <span className="font-medium">{option.label}</span>
                  {option.description == null ? null : (
                    <span className="text-muted-foreground">
                      {": "}
                      {option.description}
                    </span>
                  )}
                </OptionCard>
              );
            })}
          </fieldset>
        </div>
      ) : null}
      {state.currentStep === 4 ? (
        <div className={stepGroupClass}>
          <StepHeading title="Anything specific you're trying to achieve?" />
          <AppInput
            aria-label="Anything specific you're trying to achieve?"
            className="h-12 rounded-lg bg-input/30 px-4 dark:bg-input/30"
            onChange={(event) =>
              dispatch({
                text: event.target.value,
                type: "set-open-goal-text",
              })
            }
            placeholder="e.g. deploy an AI agent, move from VPS, test a product idea…"
            value={state.openGoalText}
          />
        </div>
      ) : null}
      <div className="flex justify-end">
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
        className="rounded-xl bg-[color:var(--project-chrome-surface-base)] bg-[image:var(--onboarding-survey-surface-overlay)]"
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
