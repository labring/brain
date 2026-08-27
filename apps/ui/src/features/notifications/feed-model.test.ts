import assert from "node:assert/strict";
import { test } from "node:test";

import type { NotificationCRItem } from "@workspace/api/hooks";

import {
  crNotificationId,
  isGiftOnlyNewcomer,
  mergeNotificationFeed,
  notificationKindForCR,
  notificationSource,
  renderNotificationMessage,
} from "./feed-model";
import { formatNotificationDate } from "./notification-time";
import type { NotificationMessage } from "./types";

const T0 = 1_756_200_000; // Unix seconds
const QUOTA_BODY_RE = /New deployments can't start/;

function cr(overrides: Partial<NotificationCRItem>): NotificationCRItem {
  return {
    desktopPopup: true,
    from: "Debt-System",
    importance: "High",
    isRead: false,
    message: "Your account balance is exhausted; services are suspended.",
    name: "debt-choice-debtperiod",
    namespace: "ns-a",
    timestamp: T0,
    title: "Balance exhausted",
    ...overrides,
  };
}

function dbMessage(
  overrides: Partial<NotificationMessage>
): NotificationMessage {
  return {
    createdAt: (T0 + 600) * 1000,
    id: "m1",
    kind: "quota-exhausted",
    payload: {
      kind: "quota-exhausted",
      limit: 20_480,
      resource: "storage",
      used: 20_480,
    },
    projectUid: null,
    ...overrides,
  };
}

test("both streams merge into one list, newest first, with source-prefixed ids", () => {
  const feed = mergeNotificationFeed({
    crItems: [
      cr({}),
      cr({
        name: "workspace-debt-debt",
        from: "Workspace-Subscription-System",
        timestamp: T0 + 1200,
      }),
    ],
    dbMessages: [dbMessage({})],
    receipts: [],
  });

  assert.deepEqual(
    feed.map((item) => item.id),
    [
      `cr:workspace-debt-debt:${T0 + 1200}`,
      "db:m1",
      `cr:debt-choice-debtperiod:${T0}`,
    ]
  );
  assert.deepEqual(
    feed.map((item) => item.timestamp),
    [(T0 + 1200) * 1000, (T0 + 600) * 1000, T0 * 1000]
  );
  assert.deepEqual(
    feed.map((item) => item.source),
    ["cr", "db", "cr"]
  );
});

test("platform copy outside the override table is shown as-is and kinds follow the upstream sender", () => {
  const [item] = mergeNotificationFeed({
    crItems: [cr({ name: "debt-choice-newtier" })],
    dbMessages: [],
    receipts: [],
  });
  assert.equal(item?.title, "Balance exhausted");
  assert.equal(
    item?.body,
    "Your account balance is exhausted; services are suspended."
  );
  assert.equal(item?.kind, "billing");
  assert.equal(item?.crName, "debt-choice-newtier");

  assert.equal(
    notificationKindForCR({ from: "Debt-System", name: "x" }),
    "billing"
  );
  assert.equal(
    notificationKindForCR({ name: "workspace-debt-debt-pre-deletion" }),
    "billing"
  );
  assert.equal(
    notificationKindForCR({ from: "Admin", name: "release-notes" }),
    "announcement"
  );
});

test("Brain entries render from their payload", () => {
  const rendered = renderNotificationMessage(dbMessage({}));
  assert.equal(rendered.kind, "quota");
  assert.equal(rendered.title, "Storage quota is full");
  assert.match(rendered.body, QUOTA_BODY_RE);
  assert.equal(
    renderNotificationMessage(
      dbMessage({
        payload: {
          kind: "quota-exhausted",
          limit: 4,
          resource: "cpu",
          used: 4,
        },
      })
    ).title,
    "CPU quota is full"
  );
});

test("unread for platform messages is label unread AND no receipt", () => {
  const unreadNoReceipt = cr({ isRead: false });
  const readByLabel = cr({ isRead: true, name: "workspace-debt-debt" });
  const unreadWithReceipt = cr({
    isRead: false,
    name: "announce",
    from: "Admin",
  });

  const feed = mergeNotificationFeed({
    crItems: [unreadNoReceipt, readByLabel, unreadWithReceipt],
    dbMessages: [],
    receipts: [crNotificationId("announce", T0)],
  });
  const byName = new Map(feed.map((item) => [item.crName, item.unread]));

  assert.equal(byName.get("debt-choice-debtperiod"), true);
  assert.equal(
    byName.get("workspace-debt-debt"),
    false,
    "upstream auto-read wins"
  );
  assert.equal(byName.get("announce"), false, "a Brain receipt wins");
});

test("a revived fixed-name CR is a new id no old receipt covers", () => {
  const oldId = crNotificationId("debt-choice-debtperiod", T0);
  const [revived] = mergeNotificationFeed({
    crItems: [cr({ timestamp: T0 + 86_400 })],
    dbMessages: [],
    receipts: [oldId],
  });

  assert.notEqual(revived?.id, oldId);
  assert.equal(revived?.unread, true);
});

test("Brain entries are unread until a receipt exists", () => {
  const unread = mergeNotificationFeed({
    crItems: [],
    dbMessages: [dbMessage({})],
    receipts: [],
  });
  const read = mergeNotificationFeed({
    crItems: [],
    dbMessages: [dbMessage({})],
    receipts: ["db:m1"],
  });
  assert.equal(unread[0]?.unread, true);
  assert.equal(read[0]?.unread, false);
});

test("ids carry their source", () => {
  assert.equal(notificationSource("cr:x:1"), "cr");
  assert.equal(notificationSource("db:m1"), "db");
  assert.equal(notificationSource("n1"), null);
});

test("the 8 fixed platform names render Brain-voiced copy and a CTA; the CR text is untouched", () => {
  const source = cr({
    message: "Radical resource release",
    name: "workspace-debt-debtfinaldeletion",
    from: "Workspace-Subscription-System",
    title: "Workspace resource final deletion",
  });
  const [item] = mergeNotificationFeed({
    crItems: [source],
    dbMessages: [],
    receipts: [],
  });

  assert.equal(item?.title, "Workspace faces final deletion");
  assert.equal(
    item?.body,
    "Resources can be permanently deleted at any time. This cannot be undone."
  );
  assert.deepEqual(item?.cta, { href: "/billing", label: "Renew plan" });
  assert.equal(item?.kind, "billing");
  assert.equal(item?.crName, "workspace-debt-debtfinaldeletion");
  assert.equal(source.message, "Radical resource release", "display-only");

  const expected: Record<string, [string, string]> = {
    "debt-choice-criticalbalanceperiod": [
      "Account balance almost empty",
      "Top up balance",
    ],
    "debt-choice-debtdeletionperiod": [
      "Account resources scheduled for deletion",
      "Top up balance",
    ],
    "debt-choice-debtperiod": ["Account balance in debt", "Top up balance"],
    "debt-choice-finaldeletionperiod": [
      "Account resources face final deletion",
      "Top up balance",
    ],
    "debt-choice-lowbalanceperiod": [
      "Account balance is low",
      "Top up balance",
    ],
    "workspace-debt-debt": ["Workspace suspended — payment due", "Renew plan"],
    "workspace-debt-debtfinaldeletion": [
      "Workspace faces final deletion",
      "Renew plan",
    ],
    "workspace-debt-debtpredeletion": [
      "Workspace deletion approaching",
      "Renew plan",
    ],
  };
  for (const [name, [title, cta]] of Object.entries(expected)) {
    const [entry] = mergeNotificationFeed({
      crItems: [cr({ name })],
      dbMessages: [],
      receipts: [],
    });
    assert.equal(entry?.title, title, name);
    assert.equal(entry?.cta?.label, cta, name);
  }
});

test("unknown platform names fall back to the original text with no CTA", () => {
  const [item] = mergeNotificationFeed({
    crItems: [
      cr({
        from: "Admin",
        message: "Maintenance tonight at 02:00 UTC.",
        name: "release-2026-08",
        title: "Scheduled maintenance",
      }),
    ],
    dbMessages: [],
    receipts: [],
  });
  assert.equal(item?.title, "Scheduled maintenance");
  assert.equal(item?.body, "Maintenance tonight at 02:00 UTC.");
  assert.equal(item?.cta, undefined);
});

test("gift-only newcomers do not see the low/critical balance tiers; the debt ladder always shows", () => {
  const crItems = [
    cr({ name: "debt-choice-lowbalanceperiod", timestamp: T0 + 1 }),
    cr({ name: "debt-choice-criticalbalanceperiod", timestamp: T0 + 2 }),
    cr({ name: "debt-choice-debtperiod", timestamp: T0 + 3 }),
    cr({ name: "workspace-debt-debt", timestamp: T0 + 4 }),
  ];
  const filtered = mergeNotificationFeed({
    crItems,
    dbMessages: [],
    giftOnly: true,
    receipts: [],
  });
  assert.deepEqual(
    filtered.map((item) => item.crName),
    ["workspace-debt-debt", "debt-choice-debtperiod"]
  );

  const unfiltered = mergeNotificationFeed({
    crItems,
    dbMessages: [],
    giftOnly: false,
    receipts: [],
  });
  assert.equal(unfiltered.length, 4);
  assert.equal(
    mergeNotificationFeed({ crItems, dbMessages: [], receipts: [] }).length,
    4,
    "unknown account state never hides a warning"
  );
});

test("isGiftOnlyNewcomer: never topped up and nothing but gift credit; one top-up ends it forever", () => {
  assert.equal(
    isGiftOnlyNewcomer({
      giftMicroUnits: 720_000,
      hasToppedUp: false,
      usableMicroUnits: 720_000,
    }),
    true
  );
  assert.equal(
    isGiftOnlyNewcomer({
      giftMicroUnits: 720_000,
      hasToppedUp: true,
      usableMicroUnits: 720_000,
    }),
    false,
    "a top-up disables the filter"
  );
  assert.equal(
    isGiftOnlyNewcomer({
      giftMicroUnits: 0,
      hasToppedUp: false,
      usableMicroUnits: 1_800_000,
    }),
    false,
    "a plan grant is not gift credit"
  );
  assert.equal(
    isGiftOnlyNewcomer({
      giftMicroUnits: 0,
      hasToppedUp: false,
      usableMicroUnits: 0,
    }),
    true,
    "a spent gift on a never-topped-up account is still nothing but gift"
  );
});

test("the gift hint renders the reassuring welcome copy with no CTA", () => {
  const rendered = renderNotificationMessage(
    dbMessage({
      id: "m2",
      kind: "credit-hint",
      payload: { giftMicroUnits: 720_000, kind: "credit-hint" },
    })
  );
  assert.equal(rendered.kind, "billing");
  assert.equal(rendered.title, "You have a $1 welcome gift");
  assert.equal(
    rendered.body,
    "It covers your first deployments and expires a month after it was granted."
  );
  assert.equal(rendered.cta, undefined);

  const dated = renderNotificationMessage(
    dbMessage({
      id: "m3",
      kind: "credit-hint",
      payload: {
        expiresAt: "2026-09-03T00:00:00.000Z",
        giftMicroUnits: 1_000_000,
        kind: "credit-hint",
      },
    })
  );
  assert.equal(
    dated.body,
    `It covers your first deployments and expires on ${formatNotificationDate("2026-09-03T00:00:00.000Z")}.`
  );
});

test("subscription-change receipts are one factual sentence per change, no CTA", () => {
  const upgraded = renderNotificationMessage(
    dbMessage({
      id: "m4",
      kind: "subscription-change",
      payload: {
        change: "upgraded",
        kind: "subscription-change",
        planName: "Pro",
      },
    })
  );
  assert.equal(upgraded.kind, "billing");
  assert.equal(upgraded.title, "Subscription upgraded");
  assert.equal(upgraded.body, "This workspace is now on Pro.");
  assert.equal(upgraded.cta, undefined);

  const effectiveAt = "2026-09-03T12:00:00.000Z";
  const date = formatNotificationDate(effectiveAt);
  const downgraded = renderNotificationMessage(
    dbMessage({
      id: "m5",
      kind: "subscription-change",
      payload: {
        change: "downgraded",
        effectiveAt,
        kind: "subscription-change",
        planName: "Hobby",
      },
    })
  );
  assert.equal(downgraded.title, "Subscription downgraded");
  assert.equal(downgraded.body, `This workspace moves to Hobby on ${date}.`);

  const cancelled = renderNotificationMessage(
    dbMessage({
      id: "m6",
      kind: "subscription-change",
      payload: {
        change: "cancelled",
        effectiveAt,
        kind: "subscription-change",
        planName: "Hobby",
      },
    })
  );
  assert.equal(cancelled.title, "Subscription cancelled");
  assert.equal(
    cancelled.body,
    `This workspace's Hobby subscription ends on ${date}.`
  );
  assert.equal(
    renderNotificationMessage(
      dbMessage({
        id: "m7",
        kind: "subscription-change",
        payload: {
          change: "cancelled",
          kind: "subscription-change",
          planName: "Hobby",
        },
      })
    ).body,
    "This workspace's Hobby subscription ends at the end of the current period."
  );
});
