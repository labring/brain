import assert from "node:assert/strict";
import { test } from "node:test";

import type { NotificationCRItem } from "@workspace/api/hooks";

import { CR_OVERRIDES } from "@/features/notifications/cr-overrides";
import { platformNotification } from "@/features/notifications/feed-model";
import type { AppNotification } from "@/features/shell/app-sidebar-notifications-model";

import {
  type BillingEscalationStage,
  billingEscalationDismissalTargets,
  billingEscalationStage,
  billingEscalationStageForName,
  selectBillingEscalation,
} from "./billing-escalation-model";

/**
 * The Billing Escalation Dialog's selection rules, driven with merged feed
 * items built the way the feed builds them (fixture CRs through
 * `platformNotification`), receipts, and the Account Debt verdict.
 */

const T0 = 1_756_800_000; // Unix seconds
const NO_RECEIPTS: ReadonlySet<string> = new Set();
const RENEWAL_PATTERN = /renew/i;

function cr(
  name: string,
  overrides: Partial<NotificationCRItem> = {}
): NotificationCRItem {
  const timestamp = overrides.timestamp ?? T0;
  return {
    desktopPopup: true,
    from: name.startsWith("workspace-")
      ? "Workspace-Subscription-System"
      : "Debt-System",
    importance: "High",
    isRead: false,
    message: `upstream body for ${name}`,
    name,
    namespace: "ns-a",
    timestamp,
    title: `upstream title for ${name}`,
    version: timestamp,
    ...overrides,
  };
}

function platform(
  name: string,
  overrides: Partial<NotificationCRItem> = {},
  receipts: ReadonlySet<string> = NO_RECEIPTS
): AppNotification {
  return platformNotification(cr(name, overrides), receipts);
}

function select(
  items: readonly AppNotification[],
  options: { accountDebt?: boolean | null; readIds?: Iterable<string> } = {}
) {
  return selectBillingEscalation({
    accountDebt: options.accountDebt === undefined ? true : options.accountDebt,
    items,
    readIds: new Set(options.readIds ?? []),
  });
}

function bodyText(stage: BillingEscalationStage | null): string {
  return (stage?.body ?? []).map((segment) => segment.text).join("");
}

test("the popup flag rides the merged item; a platform item without it never announces", () => {
  const flagged = platform("debt-choice-debtperiod");
  assert.equal(flagged.popup, true);
  const quiet = platform("debt-choice-debtperiod", { desktopPopup: false });
  assert.equal(quiet.popup, false);
  assert.equal(select([quiet]), null);
  assert.equal(select([flagged])?.announced.id, flagged.id);
});

test("the low-balance warning tiers stay in the inbox: never announced", () => {
  const items = [
    platform("debt-choice-criticalbalanceperiod", { timestamp: T0 + 60 }),
    platform("debt-choice-lowbalanceperiod"),
  ];
  assert.equal(select(items), null);
});

test("a stage already read — by the label, a receipt, or this session — is not announced", () => {
  const labelRead = platform("debt-choice-debtperiod", { isRead: true });
  assert.equal(select([labelRead]), null);

  const unread = platform("debt-choice-debtperiod");
  const receipted = platform(
    "debt-choice-debtperiod",
    {},
    new Set([unread.id])
  );
  assert.equal(select([receipted]), null);

  assert.equal(select([unread], { readIds: [unread.id] }), null);
});

test("the account ladder is announced only while Account Debt holds, and never while it is unknown", () => {
  const debt = platform("debt-choice-debtperiod");
  assert.equal(select([debt], { accountDebt: true })?.announced.id, debt.id);
  assert.equal(select([debt], { accountDebt: false }), null);
  assert.equal(select([debt], { accountDebt: null }), null);
});

test("the workspace ladder stands regardless of the Account Debt verdict", () => {
  const suspended = platform("workspace-debt-debt");
  for (const accountDebt of [true, false, null]) {
    const selection = select([suspended], { accountDebt });
    assert.equal(selection?.announced.id, suspended.id, String(accountDebt));
    assert.equal(selection?.ladder, "workspace");
  }
});

test("the newest candidate is announced and the older rungs of its ladder are superseded", () => {
  const debt = platform("debt-choice-debtperiod", { timestamp: T0 });
  const deletion = platform("debt-choice-debtdeletionperiod", {
    timestamp: T0 + 7 * 86_400,
  });
  const final = platform("debt-choice-finaldeletionperiod", {
    timestamp: T0 + 14 * 86_400,
  });
  // Feed order is irrelevant to the choice.
  const selection = select([debt, final, deletion]);
  assert.equal(selection?.announced.id, final.id);
  assert.equal(selection?.ladder, "account");
  assert.deepEqual(
    selection?.superseded.map((item) => item.id).sort(),
    [debt.id, deletion.id].sort()
  );
});

test("the superseded set is same-ladder-and-older only: other ladders, read rungs, and warning tiers stay out", () => {
  const readDebt = platform("debt-choice-debtperiod", {
    isRead: true,
    timestamp: T0,
  });
  const warning = platform("debt-choice-criticalbalanceperiod", {
    timestamp: T0 + 60,
  });
  const accountDeletion = platform("debt-choice-debtdeletionperiod", {
    timestamp: T0 + 7 * 86_400,
  });
  const workspaceSuspended = platform("workspace-debt-debt", {
    timestamp: T0 + 8 * 86_400,
  });
  const workspaceDeletion = platform("workspace-debt-debtpredeletion", {
    timestamp: T0 + 15 * 86_400,
  });
  const selection = select([
    readDebt,
    warning,
    accountDeletion,
    workspaceSuspended,
    workspaceDeletion,
  ]);
  assert.equal(selection?.announced.id, workspaceDeletion.id);
  assert.deepEqual(
    selection?.superseded.map((item) => item.id),
    [workspaceSuspended.id]
  );
});

test("a same-ladder peer written in the same second is superseded too, so a dismissal leaves nothing to reopen the dialog", () => {
  // `spec.timestamp` is Unix seconds, so two rungs can share one; the id
  // tie-break then picks the announced rung, and the other must not stay
  // unread — it would be the next poll's candidate.
  const suspended = platform("workspace-debt-debt", { timestamp: T0 });
  const deletion = platform("workspace-debt-debtpredeletion", {
    timestamp: T0,
  });
  const selection = select([deletion, suspended]);
  assert.ok(selection);
  const loser = selection.announced.id === suspended.id ? deletion : suspended;
  assert.deepEqual(
    selection.superseded.map((item) => item.id),
    [loser.id]
  );
  const readIds = billingEscalationDismissalTargets(selection).map(
    (item) => item.id
  );
  assert.equal(select([deletion, suspended], { readIds }), null);
});

test("a ladder rung the override table does not know stays in the inbox: Brain never announces upstream words", () => {
  const unknownRung = platform("debt-choice-newtier");
  assert.equal(unknownRung.severity, "critical");
  assert.equal(select([unknownRung]), null);
  assert.equal(select([platform("workspace-debt-newstage")]), null);
});

test("a Brain-origin item never qualifies, whatever it carries", () => {
  const brain: AppNotification = {
    body: "Storage is at 100%.",
    id: "db:quota-1",
    popup: true,
    severity: "critical",
    source: "db",
    timestamp: (T0 + 600) * 1000,
    title: "Storage quota is full",
    unread: true,
  };
  assert.equal(select([brain]), null);
});

test("the final-deletion fixture rung announces like every other critical stage", () => {
  const final = platform("debt-choice-finaldeletionperiod");
  const selection = select([final]);
  assert.equal(selection?.announced.crName, "debt-choice-finaldeletionperiod");
  assert.deepEqual(selection?.superseded, []);
});

test("an Account Debt stage carries the override's title and body, the top-up fix, and no date", () => {
  const debt = platform("debt-choice-debtperiod");
  const stage = billingEscalationStage(debt, {
    subscription: {
      recoveryVoice: "renew",
      warningDeadlineAt: "2026-09-17T12:00:00Z",
    },
  });
  assert.equal(stage?.ladder, "account");
  assert.equal(stage?.title, CR_OVERRIDES["debt-choice-debtperiod"]?.title);
  assert.deepEqual(stage?.body, [
    { emphasis: false, text: CR_OVERRIDES["debt-choice-debtperiod"]?.body },
  ]);
  assert.deepEqual(stage?.fix, {
    desktop: { app: "system-costcenter", label: "Top up in Sealos Desktop" },
    href: "/billing",
    label: "Top up balance",
  });
});

test("a payment-due stage sets the Deletion Countdown's deadline off in the body", () => {
  const suspended = platform("workspace-debt-debt");
  const stage = billingEscalationStage(suspended, {
    subscription: {
      recoveryVoice: "renew",
      warningDeadlineAt: "2026-09-17T12:00:00Z",
    },
  });
  assert.equal(stage?.ladder, "workspace");
  assert.equal(stage?.title, "Workspace suspended — payment due");
  assert.deepEqual(stage?.body, [
    {
      emphasis: false,
      text: "The subscription has expired and this workspace is suspended. Resources will be deleted on ",
    },
    { emphasis: true, text: "Sep 17" },
    { emphasis: false, text: " unless you renew." },
  ]);
  assert.deepEqual(stage?.fix, { href: "/billing", label: "Renew plan" });
});

test('the payment-due stages fall back to the banner\'s "soon" when no deadline is known', () => {
  const suspended = billingEscalationStage(platform("workspace-debt-debt"), {
    subscription: { recoveryVoice: "renew", warningDeadlineAt: null },
  });
  assert.equal(
    bodyText(suspended),
    "The subscription has expired and this workspace is suspended. Resources will be deleted soon unless you renew."
  );
  assert.ok(suspended?.body.every((segment) => !segment.emphasis));

  const approaching = billingEscalationStage(
    platform("workspace-debt-debtpredeletion"),
    { subscription: null }
  );
  assert.equal(approaching?.title, "Workspace deletion approaching");
  assert.equal(
    bodyText(approaching),
    "The subscription is still unpaid. Resources will be permanently deleted soon."
  );
});

test("the deletion-approaching stage dates the deletion; the final stage states no date", () => {
  const context = {
    subscription: {
      recoveryVoice: "renew" as const,
      warningDeadlineAt: "2026-09-17T12:00:00Z",
    },
  };
  const approaching = billingEscalationStage(
    platform("workspace-debt-debtpredeletion"),
    context
  );
  assert.deepEqual(approaching?.body, [
    {
      emphasis: false,
      text: "The subscription is still unpaid. Resources will be permanently deleted on ",
    },
    { emphasis: true, text: "Sep 17" },
    { emphasis: false, text: "." },
  ]);

  const final = billingEscalationStage(
    platform("workspace-debt-debtfinaldeletion"),
    context
  );
  assert.equal(final?.title, "Workspace faces final deletion");
  assert.deepEqual(final?.body, [
    {
      emphasis: false,
      text: "Resources can be permanently deleted at any time. This cannot be undone.",
    },
  ]);
  assert.deepEqual(final?.fix, { href: "/billing", label: "Renew plan" });
});

test("an unpriced Free plan is asked to upgrade, never to renew", () => {
  const stage = billingEscalationStage(platform("workspace-debt-debt"), {
    subscription: {
      recoveryVoice: "resubscribe",
      warningDeadlineAt: "2026-09-17T12:00:00Z",
    },
  });
  assert.equal(
    bodyText(stage),
    "The subscription has expired and this workspace is suspended. Resources will be deleted on Sep 17 unless you upgrade to a paid plan."
  );
  assert.deepEqual(stage?.fix, {
    href: "/billing?mode=upgrade",
    label: "Upgrade plan",
  });
  assert.doesNotMatch(bodyText(stage), RENEWAL_PATTERN);
});

test("a name outside both ladders has no stage", () => {
  assert.equal(
    billingEscalationStage(platform("announce-release"), {
      subscription: null,
    }),
    null
  );
});

test("a forced stage builds from the override table alone", () => {
  const forced = billingEscalationStageForName(
    "debt-choice-debtdeletionperiod",
    { subscription: null }
  );
  assert.equal(forced?.title, "Account resources scheduled for deletion");
  assert.equal(
    bodyText(forced),
    CR_OVERRIDES["debt-choice-debtdeletionperiod"]?.body
  );
  assert.equal(
    billingEscalationStageForName("not-a-stage", { subscription: null }),
    null
  );
});
