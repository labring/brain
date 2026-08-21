import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isActiveFreeTrialSubscription,
  judgeFreeTrialFromSubscriptionInfo,
} from "./free-trial-core";

test("a Free plan in normal standing is an Active Free Trial", () => {
  assert.equal(
    isActiveFreeTrialSubscription({
      planName: "Free",
      status: "NORMAL",
      type: "SUBSCRIPTION",
    }),
    true
  );
});

test("the predicate trims and compares case-insensitively", () => {
  assert.equal(
    isActiveFreeTrialSubscription({
      planName: "  fReE ",
      status: " normal ",
      type: " subscription ",
    }),
    true
  );
});

test("a PAUSED Free subscription is a born-suspended no-trial state", () => {
  assert.equal(
    isActiveFreeTrialSubscription({
      planName: "Free",
      status: "PAUSED",
      type: "SUBSCRIPTION",
    }),
    false
  );
});

test("an expired trial in the DEBT pipeline is not a trial", () => {
  assert.equal(
    isActiveFreeTrialSubscription({
      planName: "Free",
      status: "DEBT",
      type: "SUBSCRIPTION",
    }),
    false
  );
});

test("unknown future statuses are non-trial", () => {
  assert.equal(
    isActiveFreeTrialSubscription({
      planName: "Free",
      status: "SOME_FUTURE_STATE",
      type: "SUBSCRIPTION",
    }),
    false
  );
});

test("paid plans in normal standing are not trials", () => {
  assert.equal(
    isActiveFreeTrialSubscription({
      planName: "Hobby",
      status: "NORMAL",
      type: "SUBSCRIPTION",
    }),
    false
  );
});

test("a PAYG record is not a trial", () => {
  assert.equal(
    isActiveFreeTrialSubscription({
      planName: "PAYG",
      status: "",
      type: "PAYG",
    }),
    false
  );
});

test("judges the upstream free-trial payload as trial", () => {
  assert.equal(
    judgeFreeTrialFromSubscriptionInfo({
      subscription: {
        CancelAtPeriodEnd: true,
        PlanName: "Free",
        Status: "NORMAL",
        type: "SUBSCRIPTION",
      },
    }),
    "trial"
  );
});

test("judges a paused Free payload as not-trial", () => {
  assert.equal(
    judgeFreeTrialFromSubscriptionInfo({
      subscription: {
        PlanName: "Free",
        Status: "PAUSED",
        type: "SUBSCRIPTION",
      },
    }),
    "not-trial"
  );
});

test("judges a PAYG payload as not-trial", () => {
  assert.equal(
    judgeFreeTrialFromSubscriptionInfo({ subscription: { type: "PAYG" } }),
    "not-trial"
  );
});

test("a subscription with non-string fields judges not-trial, never throws", () => {
  assert.equal(
    judgeFreeTrialFromSubscriptionInfo({
      subscription: { PlanName: 5, Status: null, type: "SUBSCRIPTION" },
    }),
    "not-trial"
  );
});

// Fail-open (ADR-0065): an unparsable judgment must never block, so shapes
// that don't carry a subscription record at all resolve to "unknown".
test("payloads without a subscription record judge unknown", () => {
  assert.equal(judgeFreeTrialFromSubscriptionInfo({}), "unknown");
  assert.equal(judgeFreeTrialFromSubscriptionInfo(null), "unknown");
  assert.equal(judgeFreeTrialFromSubscriptionInfo("oops"), "unknown");
  assert.equal(
    judgeFreeTrialFromSubscriptionInfo({ subscription: "gone" }),
    "unknown"
  );
});
