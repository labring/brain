import "server-only";

import type { NotificationDevMockHandler } from "@/features/billing/server/dev-fixtures/notifications";

import { createNotificationHandlers } from "./http-handlers";
import { notificationStore } from "./server-store";

type NotificationRouteHandler = (request: Request) => Promise<Response>;

/**
 * Lets the Dev Mocks answer first in dev and demo builds
 * (`NEXT_PUBLIC_DEV_TWEAKS=1` marks a demo image): the Notification Center
 * mock layers its platform fixtures over the billing mock's feed or the
 * real handler, whichever is below. A real production build statically
 * drops the dynamic imports, so fixtures never reach production bundles —
 * the same gate as the /api/billing routes.
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
    const [
      { notificationDevMockResponse },
      { withPlatformNotificationDevMock },
    ] = await Promise.all([
      import("@/features/billing/server/dev-fixtures/notifications"),
      import("./dev-fixtures"),
    ]);
    return withPlatformNotificationDevMock(
      handler,
      request,
      async (layered) =>
        (await notificationDevMockResponse(handler, layered)) ?? real(layered)
    );
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
