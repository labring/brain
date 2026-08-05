import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canAdvanceOnboardingStep,
  createInitialOnboardingSurveyState,
  type OnboardingSurveyAction,
  type OnboardingSurveyState,
  onboardingCompletePayload,
  onboardingPriorityAnswerPayload,
  onboardingRoleAnswerPayload,
  onboardingSkipPayload,
  onboardingSurveyReducer,
  onboardingUsageAnswerPayload,
} from "./survey-state";

/** Deterministic RNG so display-order assertions are reproducible. */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return s / 4_294_967_296;
  };
}

function initialState(): OnboardingSurveyState {
  return createInitialOnboardingSurveyState(seededRandom(7));
}

function reduce(
  state: OnboardingSurveyState,
  ...actions: OnboardingSurveyAction[]
): OnboardingSurveyState {
  return actions.reduce(onboardingSurveyReducer, state);
}

const ALL_PRIORITY_TAGS = [
  "ease_of_use",
  "fast_launch",
  "low_cost",
  "other",
  "performance",
  "scalability",
  "stability",
] as const;

test("the display order is a per-session shuffle of every tag with Other pinned last", () => {
  const orders = [1, 7, 42].map(
    (seed) =>
      createInitialOnboardingSurveyState(seededRandom(seed))
        .priorityDisplayOrder
  );

  for (const order of orders) {
    // Every tag exactly once…
    assert.deepEqual([...order].sort(), [...ALL_PRIORITY_TAGS]);
    // …with Other always closing the list.
    assert.equal(order.at(-1), "other");
  }
  // A fresh session gets a fresh order (deterministic under these seeds).
  assert.notDeepEqual(orders[0], orders[1]);
  assert.notDeepEqual(orders[1], orders[2]);
});

test("role selection is single-select: picking replaces, re-picking clears", () => {
  const picked = reduce(initialState(), {
    role: "founder",
    type: "toggle-role",
  });
  assert.equal(picked.roleType, "founder");

  const replaced = reduce(picked, { role: "student", type: "toggle-role" });
  assert.equal(replaced.roleType, "student");

  const cleared = reduce(replaced, { role: "student", type: "toggle-role" });
  assert.equal(cleared.roleType, null);
});

test("usage selection is single-select: picking replaces, re-picking clears", () => {
  const picked = reduce(initialState(), {
    type: "toggle-usage",
    usage: "exploring",
  });
  assert.equal(picked.usageContext, "exploring");

  const replaced = reduce(picked, {
    type: "toggle-usage",
    usage: "real_business",
  });
  assert.equal(replaced.usageContext, "real_business");

  const cleared = reduce(replaced, {
    type: "toggle-usage",
    usage: "real_business",
  });
  assert.equal(cleared.usageContext, null);
});

test("priority picks keep click order and a fourth selection is refused", () => {
  const three = reduce(
    initialState(),
    { tag: "low_cost", type: "toggle-priority" },
    { tag: "stability", type: "toggle-priority" },
    { tag: "ease_of_use", type: "toggle-priority" }
  );
  // Array order = click order, not display order.
  assert.deepEqual(three.priorityTags, [
    "low_cost",
    "stability",
    "ease_of_use",
  ]);

  // The cap is 3: a fourth pick changes nothing — no swap, no reorder.
  const refused = reduce(three, {
    tag: "performance",
    type: "toggle-priority",
  });
  assert.deepEqual(refused.priorityTags, [
    "low_cost",
    "stability",
    "ease_of_use",
  ]);

  // Unpicking reopens a slot; the survivors keep their click order.
  const reopened = reduce(refused, {
    tag: "stability",
    type: "toggle-priority",
  });
  assert.deepEqual(reopened.priorityTags, ["low_cost", "ease_of_use"]);
  const swapped = reduce(reopened, {
    tag: "performance",
    type: "toggle-priority",
  });
  assert.deepEqual(swapped.priorityTags, [
    "low_cost",
    "ease_of_use",
    "performance",
  ]);
});

test("the Other free text is kept while switching selections", () => {
  const withOther = reduce(
    initialState(),
    { role: "other", type: "toggle-role" },
    { text: "platform team lead", type: "set-role-other-text" }
  );
  assert.equal(withOther.roleOtherText, "platform team lead");

  const switched = reduce(withOther, { role: "founder", type: "toggle-role" });
  assert.equal(switched.roleType, "founder");
  assert.equal(switched.roleOtherText, "platform team lead");
});

test("Next is gated per step and Step 4 is always open", () => {
  const start = initialState();
  assert.equal(canAdvanceOnboardingStep(start), false);

  const one = reduce(start, { role: "ai_builder", type: "toggle-role" });
  assert.equal(canAdvanceOnboardingStep(one), true);
  // Selecting never advances by itself — the step only changes explicitly.
  assert.equal(one.currentStep, 1);

  const two = reduce(one, { type: "advance-step" });
  assert.equal(two.currentStep, 2);
  assert.equal(canAdvanceOnboardingStep(two), false);
  const three = reduce(
    two,
    { type: "toggle-usage", usage: "side_project" },
    { type: "advance-step" }
  );
  assert.equal(three.currentStep, 3);
  assert.equal(canAdvanceOnboardingStep(three), false);

  const four = reduce(
    three,
    { tag: "fast_launch", type: "toggle-priority" },
    { type: "advance-step" }
  );
  assert.equal(four.currentStep, 4);
  // Step 4 is optional: the submit gate is open with nothing typed…
  assert.equal(canAdvanceOnboardingStep(four), true);
  // …but there is no step 5 — submit is terminal, not an advance.
  assert.equal(reduce(four, { type: "advance-step" }).currentStep, 4);

  // Answers survive the whole walk — Skip on a later step must not lose them.
  assert.equal(four.roleType, "ai_builder");
  assert.equal(four.usageContext, "side_project");
  assert.deepEqual(four.priorityTags, ["fast_launch"]);
});

test("a closed gate makes advance a no-op", () => {
  const stuck = reduce(initialState(), { type: "advance-step" });
  assert.equal(stuck.currentStep, 1);
});

test("the role write payload is the Other pair or a bare tag, never loose text", () => {
  // Nothing selected: there is nothing to persist.
  assert.equal(onboardingRoleAnswerPayload(initialState()), null);

  // A non-Other pick never carries text — even stale text kept from a
  // previous Other selection stays out of the payload.
  const founderWithStaleText = reduce(
    initialState(),
    { role: "other", type: "toggle-role" },
    { text: "platform team lead", type: "set-role-other-text" },
    { role: "founder", type: "toggle-role" }
  );
  assert.deepEqual(onboardingRoleAnswerPayload(founderWithStaleText), {
    roleOtherText: null,
    roleType: "founder",
    step: 1,
  });

  // Other stores the pair; the free text is trimmed.
  const other = reduce(
    initialState(),
    { role: "other", type: "toggle-role" },
    { text: "  platform team lead ", type: "set-role-other-text" }
  );
  assert.deepEqual(onboardingRoleAnswerPayload(other), {
    roleOtherText: "platform team lead",
    roleType: "other",
    step: 1,
  });

  // The text is optional: Other with blank text is the pair (other, NULL).
  const otherBlank = reduce(other, {
    text: "   ",
    type: "set-role-other-text",
  });
  assert.deepEqual(onboardingRoleAnswerPayload(otherBlank), {
    roleOtherText: null,
    roleType: "other",
    step: 1,
  });
});

test("the usage write payload is the Other pair or a bare tag, never loose text", () => {
  assert.equal(onboardingUsageAnswerPayload(initialState()), null);

  const staleText = reduce(
    initialState(),
    { type: "toggle-usage", usage: "other" },
    { text: "migrating a homelab", type: "set-usage-other-text" },
    { type: "toggle-usage", usage: "exploring" }
  );
  assert.deepEqual(onboardingUsageAnswerPayload(staleText), {
    step: 2,
    usageContext: "exploring",
    usageOtherText: null,
  });

  const other = reduce(
    initialState(),
    { type: "toggle-usage", usage: "other" },
    { text: " migrating a homelab  ", type: "set-usage-other-text" }
  );
  assert.deepEqual(onboardingUsageAnswerPayload(other), {
    step: 2,
    usageContext: "other",
    usageOtherText: "migrating a homelab",
  });
});

test("the priority write payload carries click order, display order, and the Other pair", () => {
  assert.equal(onboardingPriorityAnswerPayload(initialState()), null);

  const state = reduce(
    initialState(),
    { tag: "stability", type: "toggle-priority" },
    { tag: "other", type: "toggle-priority" },
    { text: "  fair pricing ", type: "set-priority-other-text" }
  );
  assert.deepEqual(onboardingPriorityAnswerPayload(state), {
    priorityDisplayOrder: state.priorityDisplayOrder,
    priorityOtherText: "fair pricing",
    priorityTags: ["stability", "other"],
    step: 3,
  });

  // Without Other among the picks the stale text stays out of the payload.
  const withoutOther = reduce(state, { tag: "other", type: "toggle-priority" });
  assert.deepEqual(onboardingPriorityAnswerPayload(withoutOther), {
    priorityDisplayOrder: state.priorityDisplayOrder,
    priorityOtherText: null,
    priorityTags: ["stability"],
    step: 3,
  });
});

test("the complete payload trims the optional open goal to text or null", () => {
  assert.deepEqual(onboardingCompletePayload(initialState()), {
    openGoalText: null,
  });
  assert.deepEqual(
    onboardingCompletePayload(
      reduce(initialState(), { text: "   ", type: "set-open-goal-text" })
    ),
    { openGoalText: null }
  );
  assert.deepEqual(
    onboardingCompletePayload(
      reduce(initialState(), {
        text: " deploy an AI agent ",
        type: "set-open-goal-text",
      })
    ),
    { openGoalText: "deploy an AI agent" }
  );
});

test("Skip reports the real current step, selection or not", () => {
  assert.deepEqual(onboardingSkipPayload(initialState()), {
    dismissedAtStep: 1,
  });
  assert.deepEqual(
    onboardingSkipPayload({ ...initialState(), currentStep: 3 }),
    { dismissedAtStep: 3 }
  );
});
