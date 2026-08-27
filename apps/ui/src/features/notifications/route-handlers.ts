import "server-only";

import type { NotificationDevMockHandler } from "@/features/billing/server/dev-fixtures/notifications";

import { createNotificationHandlers } from "./http-handlers";
import { notificationStore } from "./server-store";

type NotificationRouteHandler = (request: Request) => Promise<Response>;

/**
 * Lets the billing Dev Mock's notification fixtures answer first in dev and
 * demo builds (`NEXT_PUBLIC_DEV_TWEAKS=1` marks a demo image); a real
 * production build statically drops the dynamic import, so fixtures never
 * reach production bundles — the same gate as the /api/billing routes.
 */
function withNotificationDevMock(
  handler: NotificationDevMockHandler,
  real: NotificationRouteHandler
): NotificationRouteHandler {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return real;
  }
  return async (request) => {
    const { notificationDevMockResponse } = await import(
      "@/features/billing/server/dev-fixtures/notifications"
    );
    const mocked = await notificationDevMockResponse(handler, request);
    return mocked ?? real(request);
  };
}

const handlers = createNotificationHandlers({ store: notificationStore });

/** Production wiring for the Notification Center routes (ADR-0067). */
export const notificationRouteHandlers = {
  feed: withNotificationDevMock("feed", handlers.feed),
  markRead: withNotificationDevMock("read", handlers.markRead),
  observeGift: withNotificationDevMock("observation", handlers.observeGift),
  observeQuota: withNotificationDevMock("observation", handlers.observeQuota),
  observeSubscriptionChange: withNotificationDevMock(
    "observation",
    handlers.observeSubscriptionChange
  ),
};
