import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canAdvanceOnboardingStep,
  initialOnboardingSurveyState,
  onboardingSkipPayload,
  onboardingSurveyReducer,
} from "./survey-state";

test("role selection is single-select: picking replaces, re-picking clears", () => {
  const picked = onboardingSurveyReducer(initialOnboardingSurveyState, {
    role: "founder",
    type: "toggle-role",
  });
  assert.equal(picked.roleType, "founder");

  const replaced = onboardingSurveyReducer(picked, {
    role: "student",
    type: "toggle-role",
  });
  assert.equal(replaced.roleType, "student");

  const cleared = onboardingSurveyReducer(replaced, {
    role: "student",
    type: "toggle-role",
  });
  assert.equal(cleared.roleType, null);
});

test("the Other free text is kept while switching selections", () => {
  const withOther = onboardingSurveyReducer(
    onboardingSurveyReducer(initialOnboardingSurveyState, {
      role: "other",
      type: "toggle-role",
    }),
    { text: "platform team lead", type: "set-role-other-text" }
  );
  assert.equal(withOther.roleOtherText, "platform team lead");

  const switched = onboardingSurveyReducer(withOther, {
    role: "founder",
    type: "toggle-role",
  });
  assert.equal(switched.roleType, "founder");
  assert.equal(switched.roleOtherText, "platform team lead");
});

test("Next is gated on a selection and never auto-advances", () => {
  assert.equal(canAdvanceOnboardingStep(initialOnboardingSurveyState), false);

  const picked = onboardingSurveyReducer(initialOnboardingSurveyState, {
    role: "ai_builder",
    type: "toggle-role",
  });
  assert.equal(canAdvanceOnboardingStep(picked), true);
  // Selecting never advances by itself — the step only changes explicitly.
  assert.equal(picked.currentStep, 1);
});

test("Skip reports the real current step, selection or not", () => {
  assert.deepEqual(onboardingSkipPayload(initialOnboardingSurveyState), {
    dismissedAtStep: 1,
  });
  assert.deepEqual(
    onboardingSkipPayload({
      ...initialOnboardingSurveyState,
      currentStep: 3,
    }),
    { dismissedAtStep: 3 }
  );
});
