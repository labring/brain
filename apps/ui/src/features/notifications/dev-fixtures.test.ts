import { describe, expect, test } from "bun:test";

import { billingDevMockCookie } from "@/features/billing/dev-mock-cookie";
import { notificationDevMockResponse } from "@/features/billing/server/dev-fixtures/notifications";
import {
  platformNotificationDevMockItems,
  withPlatformNotificationDevMock,
} from "./dev-fixtures";
import {
  NOTIFICATIONS_DEV_SCENARIOS,
  notificationsDevMockCookie,
} from "./dev-mock-cookie";
import { mergeNotificationFeed } from "./feed-model";
import { crNotificationId } from "./notification-ids";
import {
  type NotificationFeedResponse,
  notificationFeedResponseSchema,
} from "./types";

const REAL_FEED: NotificationFeedResponse = {
  messages: [],
  receipts: ["db:real-1"],
};

function request(
  path: string,
  cookies: Record<string, string>,
  init?: RequestInit
): Request {
  const req = new Request(`http://localhost${path}?namespace=ns-test`, init);
  req.headers.set(
    "cookie",
    Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ")
  );
  return req;
}

const realFeed = () => Promise.resolve(Response.json(REAL_FEED));
const realRead = async (req: Request) =>
  Response.json({ read: ((await req.json()) as { ids: string[] }).ids });

describe("platform notification dev mock", () => {
  test("off hands the request down untouched", async () => {
    const response = await withPlatformNotificationDevMock(
      "feed",
      request("/api/notifications", {
        [notificationsDevMockCookie.name]: "off:mixed",
      }),
      realFeed
    );
    expect(await response.json()).toEqual(REAL_FEED);
  });

  test("an unknown scenario fails loud", async () => {
    const response = await withPlatformNotificationDevMock(
      "feed",
      request("/api/notifications", {
        [notificationsDevMockCookie.name]: "nope",
      }),
      realFeed
    );
    expect(response.status).toBe(500);
  });

  for (const scenario of NOTIFICATIONS_DEV_SCENARIOS) {
    test(`${scenario} layers fixture platform items over the real feed`, async () => {
      const response = await withPlatformNotificationDevMock(
        "feed",
        request("/api/notifications", {
          [notificationsDevMockCookie.name]: scenario,
        }),
        realFeed
      );
      const feed = notificationFeedResponseSchema.parse(await response.json());
      const expected = platformNotificationDevMockItems(scenario, "ns-test");
      expect(expected.length).toBeGreaterThan(0);
      expect(feed.platformItems).toEqual(expected);
      expect(feed.receipts).toContain("db:real-1");
      const merged = mergeNotificationFeed({
        crItems: feed.platformItems ?? [],
        dbMessages: feed.messages,
        receipts: feed.receipts,
      });
      expect(merged).toHaveLength(expected.length);
      expect(new Set(merged.map((item) => item.id)).size).toBe(expected.length);
    });
  }

  test("mixed is a month of mostly-read traffic, newest first", () => {
    const items = platformNotificationDevMockItems("mixed", "ns-test");
    expect(items.length).toBeGreaterThanOrEqual(15);
    expect(items.filter((item) => !item.isRead).length).toBeLessThan(5);
    for (let index = 1; index < items.length; index += 1) {
      expect(items[index - 1]?.timestamp).toBeGreaterThanOrEqual(
        items[index]?.timestamp ?? 0
      );
    }
  });

  test("stacks on the billing mock's feed", async () => {
    const cookies = {
      [billingDevMockCookie.name]: "payg-debt",
      [notificationsDevMockCookie.name]: "announcement",
    };
    const response = await withPlatformNotificationDevMock(
      "feed",
      request("/api/notifications", cookies),
      async (req) =>
        (await notificationDevMockResponse("feed", req)) ?? realFeed()
    );
    const feed = notificationFeedResponseSchema.parse(await response.json());
    const names = (feed.platformItems ?? []).map((item) => item.name);
    expect(names).toContain("debt-choice-debtperiod");
    expect(names).toContain("announce-db-terminal");
  });

  test("falls back to fixtures alone when the layer below fails", async () => {
    const response = await withPlatformNotificationDevMock(
      "feed",
      request("/api/notifications", {
        [notificationsDevMockCookie.name]: "db-event",
      }),
      () => Promise.resolve(Response.json({ error: "down" }, { status: 503 }))
    );
    const feed = notificationFeedResponseSchema.parse(await response.json());
    expect(feed.messages).toEqual([]);
    expect(feed.platformItems).toHaveLength(1);
  });

  test("keeps fixture read receipts in memory and forwards the rest", async () => {
    const item = platformNotificationDevMockItems("deployment", "ns-test")[0];
    if (item == null) {
      throw new Error("deployment fixture is empty");
    }
    const id = crNotificationId(item.name, item.version);
    const cookies = { [notificationsDevMockCookie.name]: "deployment" };
    const forwarded: string[][] = [];
    const next = async (req: Request) => {
      forwarded.push(((await req.json()) as { ids: string[] }).ids);
      return realRead(
        new Request(req, { body: JSON.stringify({ ids: forwarded.at(-1) }) })
      );
    };
    const response = await withPlatformNotificationDevMock(
      "read",
      request("/api/notifications/read", cookies, {
        body: JSON.stringify({ ids: [id, "db:real-1"] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      next
    );
    expect(await response.json()).toEqual({ read: [id, "db:real-1"] });
    expect(forwarded).toEqual([["db:real-1"]]);

    const feed = notificationFeedResponseSchema.parse(
      await (
        await withPlatformNotificationDevMock(
          "feed",
          request("/api/notifications", cookies),
          realFeed
        )
      ).json()
    );
    expect(feed.receipts).toContain(id);
  });
});
