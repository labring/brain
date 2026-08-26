import assert from "node:assert/strict";
import { test } from "node:test";

import type { AppNotification } from "./app-sidebar-notifications-model";
import {
  countUnreadNotifications,
  isNotificationUnread,
  notificationBadgeLabel,
  visibleNotifications,
} from "./app-sidebar-notifications-model";

function item(overrides: Partial<AppNotification>): AppNotification {
  return {
    id: "n1",
    kind: "deploy-success",
    time: "2m ago",
    title: "Deployment complete",
    unread: false,
    ...overrides,
  };
}

const NONE_READ: ReadonlySet<string> = new Set();

test("a read receipt overrides the item's own unread flag", () => {
  const unreadItem = item({ id: "a", unread: true });
  assert.equal(isNotificationUnread(unreadItem, NONE_READ), true);
  assert.equal(isNotificationUnread(unreadItem, new Set(["a"])), false);
  assert.equal(isNotificationUnread(item({ id: "b" }), NONE_READ), false);
});

test("unread count reflects receipts, not just item flags", () => {
  const items = [
    item({ id: "a", unread: true }),
    item({ id: "b", unread: true }),
    item({ id: "c" }),
  ];
  assert.equal(countUnreadNotifications(items, NONE_READ), 2);
  assert.equal(countUnreadNotifications(items, new Set(["a"])), 1);
  assert.equal(countUnreadNotifications(items, new Set(["a", "b"])), 0);
});

test("the All tab keeps every item, the Unread tab only live ones", () => {
  const items = [
    item({ id: "a", unread: true }),
    item({ id: "b", unread: true }),
    item({ id: "c" }),
  ];
  assert.equal(visibleNotifications(items, "all", NONE_READ).length, 3);
  assert.deepEqual(
    visibleNotifications(items, "unread", new Set(["a"])).map((i) => i.id),
    ["b"]
  );
});

test("the badge is silent at zero and caps at 9+", () => {
  assert.equal(notificationBadgeLabel(0), null);
  assert.equal(notificationBadgeLabel(1), "1");
  assert.equal(notificationBadgeLabel(9), "9");
  assert.equal(notificationBadgeLabel(10), "9+");
});
