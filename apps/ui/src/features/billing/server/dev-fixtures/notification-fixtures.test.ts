import assert from "node:assert/strict";
import { test } from "node:test";

import { CR_OVERRIDES } from "@/features/notifications/cr-overrides";
import {
  isGiftOnlyNewcomer,
  mergeNotificationFeed,
} from "@/features/notifications/feed-model";
import {
  NOTIFICATION_MESSAGE_KINDS,
  notificationFeedResponseSchema,
} from "@/features/notifications/types";

import { loadAccountCredits } from "../../account-credits";
import { loadHasToppedUp } from "../../account-top-up";
import {
  BILLING_DEV_MOCK_COOKIE,
  BILLING_DEV_SCENARIOS,
  type BillingDevScenario,
} from "../../dev-mock-cookie";
import { notificationDevMockResponse } from "./notifications";
import { scenarioTestFetch } from "./scenario-test-fetch";

/**
 * Pins the Notification Center's dev fixtures to the real pipeline: every
 * billing scenario answers a feed the wire schema accepts, the merged-feed
 * seam turns it into rows, and the account fixtures decide the gift-only
 * filter through the same loaders the browser uses. Together the scenarios
 * cover every catalog row — the eight fixed platform names and every
 * Brain-produced kind.
 */

const CREDENTIALS = { appToken: "test-token", kubeconfig: "test-kubeconfig" };

function mockRequest(
  pathname: string,
  scenario: string,
  init?: RequestInit
): Request {
  const request = new Request(
    new URL(`${pathname}?namespace=ns-test`, "http://localhost"),
    init
  );
  request.headers.set("cookie", `${BILLING_DEV_MOCK_COOKIE}=${scenario}`);
  return request;
}

async function feedFor(scenario: string) {
  const response = await notificationDevMockResponse(
    "feed",
    mockRequest("/api/notifications", scenario)
  );
  assert.ok(response, `${scenario}: the mock answers the feed`);
  return notificationFeedResponseSchema.parse(await response.json());
}

async function mergedFor(scenario: BillingDevScenario) {
  const feed = await feedFor(scenario);
  const fetch = scenarioTestFetch(scenario);
  const [credits, hasToppedUp] = await Promise.all([
    loadAccountCredits(CREDENTIALS, fetch),
    loadHasToppedUp(CREDENTIALS, fetch),
  ]);
  return mergeNotificationFeed({
    crItems: feed.platformItems ?? [],
    dbMessages: feed.messages,
    giftOnly: isGiftOnlyNewcomer({ ...credits, hasToppedUp }),
    receipts: feed.receipts,
  });
}

test("every scenario answers a feed the pipeline accepts, and together they cover the catalog", async () => {
  const seenNames = new Set<string>();
  const seenKinds = new Set<string>();
  for (const scenario of BILLING_DEV_SCENARIOS) {
    const feed = await feedFor(scenario);
    for (const item of feed.platformItems ?? []) {
      seenNames.add(item.name);
    }
    for (const message of feed.messages) {
      seenKinds.add(message.kind);
    }
    const merged = await mergedFor(scenario);
    assert.ok(
      merged.every((item) => item.title !== "" && item.timestamp > 0),
      `${scenario}: every row renders`
    );
  }
  for (const name of Object.keys(CR_OVERRIDES)) {
    assert.ok(seenNames.has(name), `some scenario carries ${name}`);
  }
  for (const kind of NOTIFICATION_MESSAGE_KINDS) {
    assert.ok(seenKinds.has(kind), `some scenario carries a ${kind} entry`);
  }
});

test("free: a gift-only newcomer sees the welcome hint, never the low/critical tiers", async () => {
  const feed = await feedFor("free");
  assert.ok(
    feed.platformItems?.some(
      (item) => item.name === "debt-choice-criticalbalanceperiod"
    ),
    "upstream did write the critical-balance CR"
  );
  const merged = await mergedFor("free");
  assert.deepEqual(
    merged.map((item) => item.title),
    ["You have a $1 welcome gift"]
  );
  assert.equal(merged[0]?.unread, true);
});

test("payg-debt-final: the whole account debt ladder, overridden, with only the final tier unread", async () => {
  const merged = await mergedFor("payg-debt-final");
  const ladder = merged.filter((item) => item.source === "cr");
  assert.deepEqual(
    ladder.map((item) => [item.title, item.unread]),
    [
      ["Account resources face final deletion", true],
      ["Account resources scheduled for deletion", false],
      ["Account balance in debt", false],
      ["Account balance almost empty", false],
      ["Account balance is low", false],
    ]
  );
  assert.ok(
    ladder.every((item) => item.cta?.label === "Top up balance"),
    "account money recovers by top-up"
  );
});

test("active: an unknown platform name falls back to its own text beside the upgrade receipt", async () => {
  const merged = await mergedFor("active");
  const announcement = merged.find(
    (item) => item.source === "cr" && item.severity === "info"
  );
  assert.equal(announcement?.cta, undefined);
  assert.ok(announcement?.body, "the original body survives");
  assert.ok(
    merged.some((item) => item.title === "Subscription upgraded"),
    "the settled mock checkout has its receipt"
  );
  assert.ok(
    merged.some((item) => item.title === "Account balance is low"),
    "a topped-up account keeps its low-balance history"
  );
});

test("marking read in mock mode sticks for the session and never reaches the store", async () => {
  const before = await feedFor("payment-due");
  const target = before.platformItems?.[0];
  assert.ok(target);
  const id = `cr:${target.name}:${target.timestamp}`;
  const marked = await notificationDevMockResponse(
    "read",
    mockRequest("/api/notifications/read", "payment-due", {
      body: JSON.stringify({ ids: [id] }),
      method: "POST",
    })
  );
  assert.equal(marked?.status, 200);
  const after = await feedFor("payment-due");
  assert.ok(after.receipts.includes(id));

  const observed = await notificationDevMockResponse(
    "observation",
    mockRequest("/api/notifications/gift-observation", "payment-due", {
      body: JSON.stringify({ giftMicroUnits: 1 }),
      method: "POST",
    })
  );
  assert.equal(observed?.status, 200);
});

test("an absent or disabled cookie falls through to the real handlers", async () => {
  const absent = await notificationDevMockResponse(
    "feed",
    new Request("http://localhost/api/notifications?namespace=ns-test")
  );
  assert.equal(absent, null);
  const disabled = await notificationDevMockResponse(
    "feed",
    mockRequest("/api/notifications", "off:active")
  );
  assert.equal(disabled, null);
});
