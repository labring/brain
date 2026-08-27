import assert from "node:assert/strict";
import { test } from "node:test";

import type { NotificationCRItem } from "@workspace/api/hooks";

import {
  crNotificationId,
  mergeNotificationFeed,
  notificationKindForCR,
  notificationSource,
  renderNotificationMessage,
} from "./feed-model";
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

test("platform copy is shown as-is and kinds follow the upstream sender", () => {
  const [item] = mergeNotificationFeed({
    crItems: [cr({})],
    dbMessages: [],
    receipts: [],
  });
  assert.equal(item?.title, "Balance exhausted");
  assert.equal(
    item?.body,
    "Your account balance is exhausted; services are suspended."
  );
  assert.equal(item?.kind, "billing");
  assert.equal(item?.crName, "debt-choice-debtperiod");

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
