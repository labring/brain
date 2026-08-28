import { defineDevMockCookie } from "@/features/dev-mock/cookie";

/**
 * The Notification Center Dev Mock's cookie: platform-origin Notifications
 * (announcements, deployment outcomes, database events — the `cr:` stream)
 * served from fixtures. Independent of the billing mock, whose scenario
 * keeps driving the billing-born messages; both can be on at once and the
 * inbox merges them.
 */

export const NOTIFICATIONS_DEV_SCENARIOS = [
  "announcement",
  "deployment",
  "db-event",
  "mixed",
] as const;

export type NotificationsDevScenario =
  (typeof NOTIFICATIONS_DEV_SCENARIOS)[number];

export const DEFAULT_NOTIFICATIONS_DEV_SCENARIO: NotificationsDevScenario =
  "mixed";

export const notificationsDevMockCookie =
  defineDevMockCookie<NotificationsDevScenario>({
    defaultScenario: DEFAULT_NOTIFICATIONS_DEV_SCENARIO,
    name: "sealai-notifications-dev-mock",
    scenarios: NOTIFICATIONS_DEV_SCENARIOS,
  });
