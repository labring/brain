import "server-only";

import { getNotificationDb } from "./db";
import { createNotificationHandlers } from "./http-handlers";
import { createNotificationStore } from "./store";

/** The production store; the only place the database is injected. */
export const notificationStore = createNotificationStore(getNotificationDb);

/** Production wiring for the Notification Center routes (ADR-0067). */
export const notificationRouteHandlers = createNotificationHandlers({
  store: notificationStore,
});
