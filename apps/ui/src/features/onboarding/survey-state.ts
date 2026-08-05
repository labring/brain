import {
  type AnswerOnboardingStepRequest,
  type CompleteOnboardingProfileRequest,
  ONBOARDING_PRIORITY_TAGS_MAX,
  ONBOARDING_SURVEY_TOTAL_STEPS,
  type OnboardingPriorityTag,
  type OnboardingRoleType,
  type OnboardingUsageContext,
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

/** The six non-Other Step 3 options — the pool the per-session shuffle draws from. */
const PRIORITY_TAG_POOL: readonly OnboardingPriorityTag[] = [
  "ease_of_use",
  "stability",
  "low_cost",
  "performance",
  "scalability",
  "fast_launch",
];

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
 * The terminal payload "Submit & Enter Console" fires: the optional Step 4
 * open goal, trimmed to text or null (an empty submit completes cleanly).
 */
export function onboardingCompletePayload(
  state: OnboardingSurveyState
): CompleteOnboardingProfileRequest {
  const trimmed = state.openGoalText.trim();
  return { openGoalText: trimmed === "" ? null : trimmed };
}

/** The terminal dismiss payload Skip fires: the step the survey was on. */
export function onboardingSkipPayload(state: OnboardingSurveyState): {
  dismissedAtStep: number;
} {
  return { dismissedAtStep: state.currentStep };
}
