import assert from "node:assert/strict";
import { test } from "node:test";

import { loadAccountBalanceTerms } from "@/features/billing/account-balance";
import { loadAccountCredits } from "@/features/billing/account-credits";
import { loadHasToppedUp } from "@/features/billing/account-top-up";
import { loadWorkspaceSubscriptionSummary } from "@/features/billing/billing-plan-data";
import {
  BILLING_DEV_MOCK_COOKIE,
  BILLING_DEV_SCENARIOS,
  type BillingDevScenario,
} from "@/features/billing/dev-mock-cookie";
import { notificationDevMockResponse } from "@/features/billing/server/dev-fixtures/notifications";
import { scenarioTestFetch } from "@/features/billing/server/dev-fixtures/scenario-test-fetch";
import {
  isGiftOnlyNewcomer,
  mergeNotificationFeed,
} from "@/features/notifications/feed-model";
import { notificationFeedResponseSchema } from "@/features/notifications/types";
import {
  accountDebtHolds,
  formatStatusHintDeadline,
} from "@/features/status-hint/status-hint-model";

import {
  billingEscalationStage,
  selectBillingEscalation,
} from "./billing-escalation-model";

/**
 * Pins the dialog to the billing Dev Mock through the same loaders and the
 * same merged-feed seam the hook uses, so every stage the design catalogs
 * can be staged locally and the fixtures keep meaning what their names
 * promise: each debt and payment-due scenario opens the dialog for its
 * unread rung; a subscribed workspace whose account is in debt and the
 * low-balance scenarios do not.
 */

const CREDENTIALS = {
  appToken: "test-token",
  kubeconfig: "test-kubeconfig",
  workspace: "ns-test",
};

const RENEWAL_PATTERN = /renew/i;
const UPGRADE_PATTERN = /upgrade to a paid plan/;

function feedRequest(scenario: string): Request {
  const request = new Request(
    new URL("/api/notifications?namespace=ns-test", "http://localhost")
  );
  request.headers.set("cookie", `${BILLING_DEV_MOCK_COOKIE}=${scenario}`);
  return request;
}

async function escalationFor(scenario: BillingDevScenario) {
  const fetch = scenarioTestFetch(scenario);
  const [subscription, balance, credits, hasToppedUp, response] =
    await Promise.all([
      loadWorkspaceSubscriptionSummary(CREDENTIALS, { fetch }),
      loadAccountBalanceTerms(CREDENTIALS, fetch),
      loadAccountCredits(CREDENTIALS, fetch),
      loadHasToppedUp(CREDENTIALS, fetch),
      notificationDevMockResponse("feed", feedRequest(scenario)),
    ]);
  assert.ok(response, `${scenario}: the mock answers the feed`);
  const feed = notificationFeedResponseSchema.parse(await response.json());
  const items = mergeNotificationFeed({
    crItems: feed.platformItems ?? [],
    dbMessages: feed.messages,
    giftOnly: isGiftOnlyNewcomer({ ...credits, hasToppedUp }),
    receipts: feed.receipts,
  });
  const accountDebt = accountDebtHolds({
    availableBalanceMicroUnits:
      balance.cashMicroUnits + credits.usableMicroUnits,
    lifetimeDeductionMicroUnits: balance.lifetimeDeductionMicroUnits,
    subscription,
  });
  const selection = selectBillingEscalation({
    accountDebt,
    items,
    readIds: new Set(),
  });
  return {
    selection,
    stage:
      selection == null
        ? null
        : billingEscalationStage(selection.announced, { subscription }),
    subscription,
  };
}

function bodyText(stage: { body: readonly { text: string }[] } | null) {
  return (stage?.body ?? []).map((segment) => segment.text).join("");
}

/** The rung each scenario announces — its unread stage — or nothing. */
const EXPECTED: Record<BillingDevScenario, string | null> = {
  active: null,
  "active-balance": null,
  "ai-credits-exhausted": null,
  cancelling: null,
  deleted: null,
  free: null,
  "free-expired": "workspace-debt-debt",
  "free-expiring": null,
  "mixed-workspaces": null,
  paused: null,
  payg: null,
  "payg-debt": "debt-choice-debtperiod",
  "payg-debt-deletion": "debt-choice-debtdeletionperiod",
  "payg-debt-final": "debt-choice-finaldeletionperiod",
  "payment-due": "workspace-debt-debt",
  "payment-due-deletion": "workspace-debt-debtpredeletion",
  "payment-due-final": "workspace-debt-debtfinaldeletion",
  "pending-upgrade": null,
  "quota-full": null,
  "status-unknown": null,
};

test("every scenario announces the rung its name promises, or nothing", async () => {
  for (const scenario of BILLING_DEV_SCENARIOS) {
    const { selection } = await escalationFor(scenario);
    assert.equal(
      selection?.announced.crName ?? null,
      EXPECTED[scenario],
      `${scenario}: announced`
    );
    // The fixtures leave only the newest rung unread, so nothing is superseded.
    assert.deepEqual(
      selection?.superseded ?? [],
      [],
      `${scenario}: superseded`
    );
  }
});

test("the account ladder speaks the override's words, the top-up fix, and no date", async () => {
  const { stage } = await escalationFor("payg-debt");
  assert.equal(stage?.ladder, "account");
  assert.equal(stage?.title, "Account balance in debt");
  assert.equal(
    bodyText(stage),
    "Pay-as-you-go workspaces are suspended. Top up your balance to restore them."
  );
  assert.ok(stage?.body.every((segment) => !segment.emphasis));
  assert.equal(stage?.fix.desktop?.app, "system-costcenter");

  const { stage: final } = await escalationFor("payg-debt-final");
  assert.equal(final?.title, "Account resources face final deletion");
});

test("the payment-due stages date the deletion with the Status Hint's own date", async () => {
  const suspended = await escalationFor("payment-due");
  const deadline = formatStatusHintDeadline(
    suspended.subscription.warningDeadlineAt
  );
  assert.ok(deadline, "the fixture carries a Deletion Countdown deadline");
  assert.equal(suspended.stage?.title, "Workspace suspended — payment due");
  assert.deepEqual(
    suspended.stage?.body.find((segment) => segment.emphasis),
    { emphasis: true, text: deadline }
  );
  assert.equal(
    bodyText(suspended.stage),
    `The subscription has expired and this workspace is suspended. Resources will be deleted on ${deadline} unless you renew.`
  );
  assert.deepEqual(suspended.stage?.fix, {
    href: "/billing",
    label: "Renew plan",
  });

  const approaching = await escalationFor("payment-due-deletion");
  assert.equal(approaching.stage?.title, "Workspace deletion approaching");
  assert.ok(approaching.stage?.body.some((segment) => segment.emphasis));

  const final = await escalationFor("payment-due-final");
  assert.equal(final.stage?.title, "Workspace faces final deletion");
  assert.equal(
    bodyText(final.stage),
    "Resources can be permanently deleted at any time. This cannot be undone."
  );
});

test("an expired Free trial is asked to upgrade, never to renew", async () => {
  const { stage } = await escalationFor("free-expired");
  assert.deepEqual(stage?.fix, {
    href: "/billing?mode=upgrade",
    label: "Upgrade plan",
  });
  assert.doesNotMatch(bodyText(stage), RENEWAL_PATTERN);
  assert.match(bodyText(stage), UPGRADE_PATTERN);
});
