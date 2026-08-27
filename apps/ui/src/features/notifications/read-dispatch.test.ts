import assert from "node:assert/strict";
import { test } from "node:test";

import type { AppNotification } from "@/features/shell/app-sidebar-notifications-model";

import { planReadDispatch, shouldSyncCRReadLabel } from "./read-dispatch";

function item(overrides: Partial<AppNotification>): AppNotification {
  return {
    id: "db:m1",
    kind: "quota",
    source: "db",
    timestamp: 0,
    title: "Storage quota is full",
    unread: true,
    ...overrides,
  };
}

const MIXED = [
  item({}),
  item({
    crName: "debt-choice-debtperiod",
    id: "cr:debt-choice-debtperiod:1",
    source: "cr",
  }),
  item({
    crName: "debt-choice-debtperiod",
    id: "cr:debt-choice-debtperiod:2",
    source: "cr",
  }),
];

test("every id gets a receipt; Owners and Managers also patch the CRs once each", () => {
  for (const role of ["OWNER", "MANAGER"] as const) {
    const plan = planReadDispatch(MIXED, role);
    assert.deepEqual(plan.receiptIds, [
      "db:m1",
      "cr:debt-choice-debtperiod:1",
      "cr:debt-choice-debtperiod:2",
    ]);
    assert.deepEqual(plan.crNames, ["debt-choice-debtperiod"]);
  }
});

test("Developers skip the CR patch but still get the receipt", () => {
  const plan = planReadDispatch(MIXED, "DEVELOPER");
  assert.equal(plan.receiptIds.length, 3);
  assert.deepEqual(plan.crNames, []);
  assert.equal(shouldSyncCRReadLabel("DEVELOPER"), false);
});

test("an unknown role tries the patch (the cluster decides)", () => {
  assert.equal(shouldSyncCRReadLabel(null), true);
  assert.equal(shouldSyncCRReadLabel(undefined), true);
  assert.deepEqual(planReadDispatch(MIXED, null).crNames, [
    "debt-choice-debtperiod",
  ]);
});
