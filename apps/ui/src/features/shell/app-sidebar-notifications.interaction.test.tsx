import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@testing-library/react/pure";
import type { NotificationCRItem } from "@workspace/api/hooks";

import { CR_OVERRIDES } from "@/features/notifications/cr-overrides";
import { mergeNotificationFeed } from "@/features/notifications/feed-model";
import type { NotificationMessage } from "@/features/notifications/types";
import type { NotificationFeed } from "@/features/notifications/use-notification-feed";
import { withTestDom } from "@/features/project-canvas/react-test-harness";

import {
  type AppNotification,
  countUnreadNotifications,
} from "./app-sidebar-notifications-model";

/**
 * AIM-334's display layer, as the user sees it: the 8 fixed-name CRs paint
 * their Brain-voiced title, body, and CTA, and the Brain-produced entries
 * (A1, D4, B5) paint the sentence that carries the fact — not just a title.
 */

const NOW_SECONDS = Math.floor(Date.parse("2026-08-27T12:00:00Z") / 1000);

function platformCR(
  name: string,
  overrides: Partial<NotificationCRItem> = {}
): NotificationCRItem {
  return {
    desktopPopup: true,
    from: "Debt-System",
    isRead: false,
    message: `upstream body for ${name}`,
    name,
    namespace: "ns-a",
    timestamp: NOW_SECONDS,
    title: `upstream title for ${name}`,
    version: NOW_SECONDS,
    ...overrides,
  };
}

const GIFT_HINT: NotificationMessage = {
  createdAt: (NOW_SECONDS - 60) * 1000,
  id: "gift-1",
  kind: "credit-hint",
  payload: { giftMicroUnits: 1_000_000, kind: "credit-hint" },
  projectUid: null,
};

const DOWNGRADE_RECEIPT: NotificationMessage = {
  createdAt: (NOW_SECONDS - 120) * 1000,
  id: "sub-1",
  kind: "subscription-change",
  payload: {
    change: "downgraded",
    effectiveAt: "2026-09-30T00:00:00Z",
    kind: "subscription-change",
    planName: "Hobby",
  },
  projectUid: null,
};

const QUOTA_FULL: NotificationMessage = {
  createdAt: (NOW_SECONDS - 180) * 1000,
  id: "quota-1",
  kind: "quota-exhausted",
  payload: { kind: "quota-exhausted", limit: 10, resource: "cpu", used: 10 },
  projectUid: null,
};

function feedOf(items: readonly AppNotification[]): NotificationFeed {
  return {
    items,
    markAllRead: () => undefined,
    markManyRead: () => undefined,
    markRead: () => undefined,
    readIds: new Set(),
    unreadCount: countUnreadNotifications(items, new Set()),
  };
}

async function renderPanel(
  feed: NotificationFeed,
  run: (
    rendered: ReturnType<typeof render>,
    act: (run: () => void) => Promise<void>
  ) => void | Promise<void>
) {
  await withTestDom(async (act) => {
    const { NotificationsPanel } = await import("./app-sidebar-notifications");
    let rendered: ReturnType<typeof render> | undefined;
    try {
      await act(() => {
        rendered = render(<NotificationsPanel feed={feed} />);
      });
      if (rendered != null) {
        await run(rendered, act);
      }
    } finally {
      await act(() => rendered?.unmount());
    }
  });
}

test("every fixed-name debt-ladder CR renders its override title, body, and CTA", async () => {
  const names = Object.keys(CR_OVERRIDES);
  assert.equal(names.length, 8);
  const items = mergeNotificationFeed({
    crItems: names.map((name, index) =>
      platformCR(name, {
        timestamp: NOW_SECONDS - index,
        version: NOW_SECONDS - index,
      })
    ),
    dbMessages: [],
    receipts: [],
  });

  await renderPanel(feedOf(items), (rendered) => {
    const text = rendered.container.textContent ?? "";
    for (const name of names) {
      const override = CR_OVERRIDES[name];
      assert.ok(override);
      assert.ok(text.includes(override.title), `${name}: title is shown`);
      assert.ok(text.includes(override.body), `${name}: body is shown`);
      assert.equal(
        rendered
          .getAllByRole("button", { name: override.cta.label })
          .some((cta) => cta.getAttribute("href") === override.cta.href),
        true,
        `${name}: CTA ${override.cta.label} → ${override.cta.href}`
      );
      // The display layer replaces upstream copy; it never shows both.
      assert.equal(text.includes(`upstream title for ${name}`), false);
      assert.equal(text.includes(`upstream body for ${name}`), false);
    }
  });
});

test("an unknown platform message falls back to its upstream title and body", async () => {
  const items = mergeNotificationFeed({
    crItems: [
      platformCR("release-notes", { from: "Sealos", message: "v3 shipped." }),
    ],
    dbMessages: [],
    receipts: [],
  });

  await renderPanel(feedOf(items), (rendered) => {
    const text = rendered.container.textContent ?? "";
    assert.ok(text.includes("upstream title for release-notes"));
    assert.ok(text.includes("v3 shipped."));
  });
});

test("Brain-produced entries render the sentence that carries the fact", async () => {
  const items = mergeNotificationFeed({
    crItems: [],
    dbMessages: [GIFT_HINT, DOWNGRADE_RECEIPT, QUOTA_FULL],
    receipts: [],
  });

  await renderPanel(feedOf(items), (rendered) => {
    const text = rendered.container.textContent ?? "";
    // D4: the welcome and what the gift is for.
    assert.ok(text.includes("You have a $1 welcome gift"));
    assert.ok(
      text.includes(
        "It covers your first deployments and expires a month after it was granted."
      )
    );
    // B5: the receipt names the plan and the date.
    assert.ok(text.includes("Subscription downgraded"));
    assert.ok(text.includes("This workspace moves to Hobby on"));
    // A1: the resource, the consequence, and the way out.
    assert.ok(text.includes("CPU quota is full"));
    assert.ok(text.includes("CPU is at 100%. New deployments will fail."));
    assert.equal(
      rendered.getByRole("button", { name: "View usage" }).getAttribute("href"),
      "/billing/usage"
    );
  });
});

test("clicking a row marks it read and expands its clamped body", async () => {
  const items = mergeNotificationFeed({
    crItems: [platformCR("workspace-debt-debt")],
    dbMessages: [],
    receipts: [],
  });
  const read: string[] = [];
  const feed: NotificationFeed = {
    ...feedOf(items),
    markRead: (item) => {
      read.push(item.id);
    },
  };

  await renderPanel(feed, async (rendered, act) => {
    const row = rendered.container.querySelector<HTMLElement>(
      '[data-slot="app-sidebar-notification-row"]'
    );
    assert.ok(row);
    // The innermost span holding the copy is the clamped one.
    const body = [...row.querySelectorAll("span")]
      .reverse()
      .find((span) =>
        span.textContent?.includes(
          CR_OVERRIDES["workspace-debt-debt"]?.body ?? ""
        )
      );
    assert.ok(body, "the body is in the document before any click");
    assert.ok(body.classList.contains("line-clamp-3"), "clamped at rest");
    const toggle = row.querySelector("button");
    assert.ok(toggle);
    await act(() => toggle.click());
    assert.deepEqual(
      read,
      items.map((item) => item.id)
    );
    assert.equal(body.classList.contains("line-clamp-3"), false, "expanded");
  });
});
