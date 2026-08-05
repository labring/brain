import type { AnswerOnboardingStepRequest, OnboardingRoleType } from "./types";

/**
 * Survey flow state as plain data + pure functions (the spec's pure-reducer
 * seam): thin components render it, so all flow logic is unit-testable
 * without DOM. Step 1 is the real role question; later steps extend the
 * state and actions without changing the shape of the seam.
 */
export interface OnboardingSurveyState {
  /** The real current step, shown by the indicator and sent with Skip. */
  currentStep: number;
  roleOtherText: string;
  roleType: OnboardingRoleType | null;
}

export type OnboardingSurveyAction =
  | { text: string; type: "set-role-other-text" }
  | { type: "advance-step" }
  | { role: OnboardingRoleType; type: "toggle-role" };

export const initialOnboardingSurveyState: OnboardingSurveyState = {
  currentStep: 1,
  roleOtherText: "",
  roleType: null,
};

export function onboardingSurveyReducer(
  state: OnboardingSurveyState,
  action: OnboardingSurveyAction
): OnboardingSurveyState {
  switch (action.type) {
    case "advance-step":
      // Advancing is always explicit (Next), gated on the current step's
      // answer, and one step at a time; answers already given are kept.
      return canAdvanceOnboardingStep(state)
        ? { ...state, currentStep: state.currentStep + 1 }
        : state;
    case "set-role-other-text":
      return { ...state, roleOtherText: action.text };
    case "toggle-role":
      // Step 1 is semantically single-select regardless of the checkbox-like
      // visual: picking an option replaces the previous pick, re-picking it
      // clears the selection.
      return {
        ...state,
        roleType: state.roleType === action.role ? null : action.role,
      };
    default:
      return state;
  }
}

/** Next stays disabled at zero selections; there is no auto-advance anywhere. */
export function canAdvanceOnboardingStep(
  state: OnboardingSurveyState
): boolean {
  // Per-step gate: Step 1 needs a role; the Step 2 placeholder has nothing
  // to answer yet, so its gate stays closed until a later ticket opens it.
  return state.currentStep === 1 && state.roleType !== null;
}

/**
 * The stepwise write payload Next fires on Step 1, or `null` with nothing
 * selected (Next is disabled then). Other is always a pair: the literal
 * `other` tag plus the trimmed optional text; any other tag carries no text,
 * even when stale Other text is still sitting in the state.
 */
export function onboardingRoleAnswerPayload(
  state: OnboardingSurveyState
): Extract<AnswerOnboardingStepRequest, { step: 1 }> | null {
  if (state.roleType === null) {
    return null;
  }
  const text = state.roleOtherText.trim();
  return {
    roleOtherText: state.roleType === "other" && text !== "" ? text : null,
    roleType: state.roleType,
    step: 1,
  };
}

/** The terminal dismiss payload Skip fires: the step the survey was on. */
export function onboardingSkipPayload(state: OnboardingSurveyState): {
  dismissedAtStep: number;
} {
  return { dismissedAtStep: state.currentStep };
}
