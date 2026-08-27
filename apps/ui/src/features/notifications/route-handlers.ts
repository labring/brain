import "server-only";

import { createNotificationHandlers } from "./http-handlers";
import { notificationStore } from "./server-store";

/** Production wiring for the Notification Center routes (ADR-0067). */
export const notificationRouteHandlers = createNotificationHandlers({
  store: notificationStore,
});
