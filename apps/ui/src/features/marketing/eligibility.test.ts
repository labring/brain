import assert from "node:assert/strict";
import { test } from "node:test";

import {
  eligibleMarketingTouches,
  evaluateMarketingClickIdEligibility,
  MARKETING_CLICK_ID_COOLDOWN_MS,
  MARKETING_CLICK_ID_RETENTION_MS,
} from "./eligibility";
import type { MarketingTouch } from "./types";

const touch: MarketingTouch = {
  campaign: "",
  channel: "paid_search",
  click_id_type: "gclid",
  click_id_value: "gclid-test",
  content: "",
  landing_hostname: "sealos.io",
  landing_path: "/",
  medium: "paid",
  source: "google",
  term: "",
  ts: "2026-08-01T00:00:00.000Z",
};

const referenceTime = new Date("2026-08-08T00:00:00.000Z");

test("click IDs remain deferred during the six-hour cooling period", () => {
  const sixHoursAgo = new Date(
    referenceTime.getTime() - MARKETING_CLICK_ID_COOLDOWN_MS
  );
  const recent = {
    ...touch,
    ts: new Date(sixHoursAgo.getTime() + 1).toISOString(),
  };
  assert.equal(
    evaluateMarketingClickIdEligibility(recent, referenceTime),
    "deferred"
  );
  assert.equal(
    evaluateMarketingClickIdEligibility(touch, referenceTime),
    "eligible"
  );
});

test("click IDs expire at the ninety-day retention boundary", () => {
  const ninetyDaysAgo = new Date(
    referenceTime.getTime() - MARKETING_CLICK_ID_RETENTION_MS
  );
  const expired = { ...touch, ts: ninetyDaysAgo.toISOString() };
  assert.equal(
    evaluateMarketingClickIdEligibility(expired, referenceTime),
    "expired"
  );
});

test("upload candidates contain only eligible click-bearing touches", () => {
  const recent = {
    ...touch,
    ts: new Date(referenceTime.getTime() - 60 * 60 * 1000).toISOString(),
  };
  const withoutClick = { ...touch, click_id_value: "" };
  assert.deepEqual(
    eligibleMarketingTouches([recent, withoutClick, touch], referenceTime),
    [touch]
  );
});
