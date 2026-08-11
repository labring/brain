import type {
  BrainGtmOnboardingSkipEvent,
  BrainGtmOnboardingStep,
  BrainGtmOnboardingStepViewEvent,
} from "@/features/analytics/brain-gtm";

import {
  type AnswerOnboardingStepRequest,
  type CompleteOnboardingProfileRequest,
  type DismissOnboardingProfileRequest,
  ONBOARDING_PRIORITY_TAGS_MAX,
  ONBOARDING_SURVEY_TOTAL_STEPS,
  type OnboardingAnswersSnapshot,
  type OnboardingPriorityTag,
  type OnboardingRoleType,
  type OnboardingUsageContext,
  onboardingPriorityTagSchema,
} from "./types";

/**
 * Survey flow state as plain data + pure functions (the spec's pure-reducer
 * seam): thin components render it, so all flow logic is unit-testable
 * without DOM. Selections, Other texts, and the Step 3 display order all
 * live here.
 */
export interface OnboardingSurveyState {
  /** The real current step, shown by the indicator and sent with Skip. */
  currentStep: number;
  openGoalText: string;
  /** The randomized Step 3 option order this session, Other pinned last. */
  priorityDisplayOrder: OnboardingPriorityTag[];
  priorityOtherText: string;
  /** Step 3 picks; array order = click order. */
  priorityTags: OnboardingPriorityTag[];
  roleOtherText: string;
  roleType: OnboardingRoleType | null;
  usageContext: OnboardingUsageContext | null;
  usageOtherText: string;
}

export type OnboardingSurveyAction =
  | { text: string; type: "set-open-goal-text" }
  | { text: string; type: "set-priority-other-text" }
  | { text: string; type: "set-role-other-text" }
  | { text: string; type: "set-usage-other-text" }
  | { type: "advance-step" }
  | { role: OnboardingRoleType; type: "toggle-role" }
  | { tag: OnboardingPriorityTag; type: "toggle-priority" }
  | { type: "toggle-usage"; usage: OnboardingUsageContext };

/** The non-Other Step 3 options — the pool the per-session shuffle draws from. */
const PRIORITY_TAG_POOL: readonly OnboardingPriorityTag[] =
  onboardingPriorityTagSchema.options.filter((tag) => tag !== "other");

/**
 * The Step 3 display order: the six non-Other options in a fresh random
 * order each session (an unbiased draw-without-replacement over the injected
 * RNG), Other always pinned last. The order is captured with the answer so
 * position bias in click-order data stays measurable (spec #88).
 */
export function onboardingPriorityDisplayOrder(
  random: () => number = Math.random
): OnboardingPriorityTag[] {
  const pool = [...PRIORITY_TAG_POOL];
  const shuffled: OnboardingPriorityTag[] = [];
  while (pool.length > 0) {
    const [tag] = pool.splice(Math.floor(random() * pool.length), 1);
    if (tag !== undefined) {
      shuffled.push(tag);
    }
  }
  return [...shuffled, "other"];
}

/** A fresh session's state; the RNG seam keeps the shuffle testable. */
export function createInitialOnboardingSurveyState(
  random: () => number = Math.random
): OnboardingSurveyState {
  return {
    currentStep: 1,
    openGoalText: "",
    priorityDisplayOrder: onboardingPriorityDisplayOrder(random),
    priorityOtherText: "",
    priorityTags: [],
    roleOtherText: "",
    roleType: null,
    usageContext: null,
    usageOtherText: "",
  };
}

export function onboardingSurveyReducer(
  state: OnboardingSurveyState,
  action: OnboardingSurveyAction
): OnboardingSurveyState {
  switch (action.type) {
    case "advance-step":
      // Advancing is always explicit (Next), gated on the current step's
      // answer, and one step at a time; answers already given are kept.
      // Step 4 has no step to advance to — its exit is the terminal submit.
      return canAdvanceOnboardingStep(state) &&
        !onboardingOtherTextMissing(state) &&
        state.currentStep < ONBOARDING_SURVEY_TOTAL_STEPS
        ? { ...state, currentStep: state.currentStep + 1 }
        : state;
    case "set-open-goal-text":
      return { ...state, openGoalText: action.text };
    case "set-priority-other-text":
      return { ...state, priorityOtherText: action.text };
    case "set-role-other-text":
      return { ...state, roleOtherText: action.text };
    case "set-usage-other-text":
      return { ...state, usageOtherText: action.text };
    case "toggle-priority": {
      // Step 3 is multi-select capped at 3: unpicking always works, a pick
      // appends in click order, and a fourth pick is refused outright.
      if (state.priorityTags.includes(action.tag)) {
        return {
          ...state,
          priorityTags: state.priorityTags.filter((tag) => tag !== action.tag),
        };
      }
      return state.priorityTags.length >= ONBOARDING_PRIORITY_TAGS_MAX
        ? state
        : { ...state, priorityTags: [...state.priorityTags, action.tag] };
    }
    case "toggle-role":
      // Steps 1 and 2 are semantically single-select regardless of the
      // checkbox-like visual: picking an option replaces the previous pick,
      // re-picking it clears the selection.
      return {
        ...state,
        roleType: state.roleType === action.role ? null : action.role,
      };
    case "toggle-usage":
      return {
        ...state,
        usageContext: state.usageContext === action.usage ? null : action.usage,
      };
    default:
      return state;
  }
}

/**
 * A selected Other must carry text before its step can advance. Next stays
 * clickable while the text is missing — the click surfaces the inline
 * "This field is required." error instead of advancing (design spec), so
 * this is a separate predicate from `canAdvanceOnboardingStep`, which drives
 * the disabled state.
 */
export function onboardingOtherTextMissing(
  state: OnboardingSurveyState
): boolean {
  switch (state.currentStep) {
    case 1:
      return state.roleType === "other" && state.roleOtherText.trim() === "";
    case 2:
      return (
        state.usageContext === "other" && state.usageOtherText.trim() === ""
      );
    case 3:
      return (
        state.priorityTags.includes("other") &&
        state.priorityOtherText.trim() === ""
      );
    default:
      return false;
  }
}

/** Next stays disabled at zero selections; there is no auto-advance anywhere. */
export function canAdvanceOnboardingStep(
  state: OnboardingSurveyState
): boolean {
  switch (state.currentStep) {
    case 1:
      return state.roleType !== null;
    case 2:
      return state.usageContext !== null;
    case 3:
      return state.priorityTags.length > 0;
    case 4:
      // The open goal is optional: submit is never gated.
      return true;
    default:
      return false;
  }
}

/** Other is a pair: text only travels with the `other` tag, trimmed. */
function otherPairText(selected: boolean, text: string): string | null {
  const trimmed = text.trim();
  return selected && trimmed !== "" ? trimmed : null;
}

/**
 * The stepwise write payload Next fires on Step 1, or `null` with nothing
 * selected (Next is disabled then). Any non-Other tag carries no text, even
 * when stale Other text is still sitting in the state.
 */
export function onboardingRoleAnswerPayload(
  state: OnboardingSurveyState
): Extract<AnswerOnboardingStepRequest, { step: 1 }> | null {
  if (state.roleType === null) {
    return null;
  }
  return {
    roleOtherText: otherPairText(
      state.roleType === "other",
      state.roleOtherText
    ),
    roleType: state.roleType,
    step: 1,
  };
}

/** The stepwise write payload Next fires on Step 2; same pair rules. */
export function onboardingUsageAnswerPayload(
  state: OnboardingSurveyState
): Extract<AnswerOnboardingStepRequest, { step: 2 }> | null {
  if (state.usageContext === null) {
    return null;
  }
  return {
    step: 2,
    usageContext: state.usageContext,
    usageOtherText: otherPairText(
      state.usageContext === "other",
      state.usageOtherText
    ),
  };
}

/**
 * The stepwise write payload Next fires on Step 3: picks in click order plus
 * the display order actually shown; the Other text travels only while Other
 * is among the picks.
 */
export function onboardingPriorityAnswerPayload(
  state: OnboardingSurveyState
): Extract<AnswerOnboardingStepRequest, { step: 3 }> | null {
  if (state.priorityTags.length === 0) {
    return null;
  }
  return {
    priorityDisplayOrder: [...state.priorityDisplayOrder],
    priorityOtherText: otherPairText(
      state.priorityTags.includes("other"),
      state.priorityOtherText
    ),
    priorityTags: [...state.priorityTags],
    step: 3,
  };
}

/**
 * The Terminal Snapshot this session earned: the answers of every step
 * already confirmed with Next (strictly below the current step — a selection
 * still sitting on the current step was never confirmed). It rides on the
 * terminal write so a Sampled row is complete even when a stepwise write
 * silently failed.
 */
export function onboardingAnswersSnapshot(
  state: OnboardingSurveyState
): OnboardingAnswersSnapshot {
  return [
    onboardingRoleAnswerPayload(state),
    onboardingUsageAnswerPayload(state),
    onboardingPriorityAnswerPayload(state),
  ].filter(
    (payload): payload is AnswerOnboardingStepRequest =>
      payload !== null && payload.step < state.currentStep
  );
}

/**
 * The terminal payload "Submit & Enter Console" fires: the Terminal Snapshot
 * (submit sits on Step 4, so all three answer steps are confirmed) plus the
 * optional open goal, trimmed to text or null (an empty submit completes
 * cleanly).
 */
export function onboardingCompletePayload(
  state: OnboardingSurveyState
): CompleteOnboardingProfileRequest {
  const trimmed = state.openGoalText.trim();
  return {
    answers: onboardingAnswersSnapshot(state),
    openGoalText: trimmed === "" ? null : trimmed,
  };
}

/**
 * The terminal dismiss payload Skip fires: the step the survey was on, plus
 * the Terminal Snapshot of the steps confirmed before it. The current step's
 * unconfirmed selection and any Step 4 draft stay out — Skip declines to
 * submit them.
 */
export function onboardingSkipPayload(
  state: OnboardingSurveyState
): DismissOnboardingProfileRequest {
  return {
    answers: onboardingAnswersSnapshot(state),
    dismissedAtStep: state.currentStep,
  };
}

/** Narrows the reducer's numeric step to the closed GTM step union. */
function onboardingGtmStep(step: number): BrainGtmOnboardingStep | null {
  return step === 1 || step === 2 || step === 3 || step === 4 ? step : null;
}

/**
 * The funnel view event for a step being shown; the dialog's appearance is
 * step 1. Structure-only (spec #88): the event type has no fields for answer
 * values, free text, or user IDs, so nothing else can travel to GTM.
 */
export function onboardingStepViewEvent(
  step: number
): BrainGtmOnboardingStepViewEvent | null {
  const gtmStep = onboardingGtmStep(step);
  return gtmStep === null
    ? null
    : { event: "onboarding_step_view", step: gtmStep };
}

/** The funnel skip event: just the step the person left from. */
export function onboardingSkipEvent(
  step: number
): BrainGtmOnboardingSkipEvent | null {
  const gtmStep = onboardingGtmStep(step);
  return gtmStep === null ? null : { event: "onboarding_skip", step: gtmStep };
}
