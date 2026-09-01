import assert from "node:assert/strict";
import { test } from "node:test";

import { planUpgradeCeiling } from "./billing-plan-catalog";

test("the plan ceiling holds only when every other plan is a downgrade target", () => {
  const plans = [
    { downgradePlanNames: [], name: "Hobby" },
    { downgradePlanNames: ["Hobby"], name: "Pro" },
    { downgradePlanNames: ["Hobby", "Pro"], name: "Team" },
  ];
  assert.equal(planUpgradeCeiling(plans, "Hobby"), false);
  // A plan outside both transition lists still counts as an upgrade offer,
  // mirroring the picker's decision tree.
  assert.equal(planUpgradeCeiling(plans, "Pro"), false);
  assert.equal(planUpgradeCeiling(plans, "Team"), true);
  // A plan the catalog no longer lists answers unknown, never guessed.
  assert.equal(planUpgradeCeiling(plans, "Legacy"), null);
});
