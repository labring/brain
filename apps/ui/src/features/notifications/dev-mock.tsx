"use client";

import { useDevTweaksMock } from "@workspace/dev-tweaks";
import { mutate } from "swr";

import { createDevMockCookieSource } from "@/features/dev-mock/source";

import {
  DEFAULT_NOTIFICATIONS_DEV_SCENARIO,
  NOTIFICATIONS_DEV_SCENARIOS,
  notificationsDevMockCookie,
} from "./dev-mock-cookie";

export const NOTIFICATIONS_DEV_MOCK_KEY = "notifications-mock";

/** Only the Brain feed carries the fixture platform items. */
function isNotificationFeedKey(key: unknown): boolean {
  return Array.isArray(key) && key[0] === "notifications-feed";
}

const notificationsDevMockSource = createDevMockCookieSource(
  notificationsDevMockCookie
);

/**
 * Registers the Notification Center's Dev Mock with the app-global registry;
 * renders nothing. Stacks with the billing mock: this one adds the
 * platform-origin messages, that one keeps the billing-born ones.
 */
export function NotificationsDevMockTweaks() {
  useDevTweaksMock(NOTIFICATIONS_DEV_MOCK_KEY, {
    defaultScenario: DEFAULT_NOTIFICATIONS_DEV_SCENARIO,
    note: "Adds platform-origin Notifications from fixtures; stacks with the billing mock",
    revalidate: () => {
      mutate(isNotificationFeedKey).catch(() => undefined);
    },
    scenarios: NOTIFICATIONS_DEV_SCENARIOS,
    source: notificationsDevMockSource,
    title: "Notification Center mock",
  });
  return null;
}
