import type { OnboardingRoleType } from "./types";

/**
 * Survey flow state as plain data + pure functions (the spec's pure-reducer
 * seam): thin components render it, so all flow logic is unit-testable
 * without DOM. This tracer bullet carries Step 1 only; later steps extend the
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
  return state.roleType !== null;
}

/** The terminal dismiss payload Skip fires: the step the survey was on. */
export function onboardingSkipPayload(state: OnboardingSurveyState): {
  dismissedAtStep: number;
} {
  return { dismissedAtStep: state.currentStep };
}
