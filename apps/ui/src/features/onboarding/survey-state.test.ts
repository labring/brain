import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canAdvanceOnboardingStep,
  initialOnboardingSurveyState,
  onboardingRoleAnswerPayload,
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

test("Next advances exactly one gated step and never past the placeholder", () => {
  // No selection: the gate is closed and advance is a no-op.
  const stuck = onboardingSurveyReducer(initialOnboardingSurveyState, {
    type: "advance-step",
  });
  assert.equal(stuck.currentStep, 1);

  const picked = onboardingSurveyReducer(initialOnboardingSurveyState, {
    role: "founder",
    type: "toggle-role",
  });
  const advanced = onboardingSurveyReducer(picked, { type: "advance-step" });
  assert.equal(advanced.currentStep, 2);
  // The answer survives the advance — Skip on a later step must not lose it.
  assert.equal(advanced.roleType, "founder");

  // Step 2 is a placeholder on this slice: nothing selectable, so the gate
  // stays closed and advance is again a no-op.
  assert.equal(canAdvanceOnboardingStep(advanced), false);
  const parked = onboardingSurveyReducer(advanced, { type: "advance-step" });
  assert.equal(parked.currentStep, 2);
});

test("the role write payload is the Other pair or a bare tag, never loose text", () => {
  // Nothing selected: there is nothing to persist.
  assert.equal(onboardingRoleAnswerPayload(initialOnboardingSurveyState), null);

  // A non-Other pick never carries text — even stale text kept from a
  // previous Other selection stays out of the payload.
  const founderWithStaleText = onboardingSurveyReducer(
    onboardingSurveyReducer(
      onboardingSurveyReducer(initialOnboardingSurveyState, {
        role: "other",
        type: "toggle-role",
      }),
      { text: "platform team lead", type: "set-role-other-text" }
    ),
    { role: "founder", type: "toggle-role" }
  );
  assert.deepEqual(onboardingRoleAnswerPayload(founderWithStaleText), {
    roleOtherText: null,
    roleType: "founder",
    step: 1,
  });

  // Other stores the pair; the free text is trimmed.
  const other = onboardingSurveyReducer(
    onboardingSurveyReducer(initialOnboardingSurveyState, {
      role: "other",
      type: "toggle-role",
    }),
    { text: "  platform team lead ", type: "set-role-other-text" }
  );
  assert.deepEqual(onboardingRoleAnswerPayload(other), {
    roleOtherText: "platform team lead",
    roleType: "other",
    step: 1,
  });

  // The text is optional: Other with blank text is the pair (other, NULL).
  const otherBlank = onboardingSurveyReducer(other, {
    text: "   ",
    type: "set-role-other-text",
  });
  assert.deepEqual(onboardingRoleAnswerPayload(otherBlank), {
    roleOtherText: null,
    roleType: "other",
    step: 1,
  });
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
