"use client";

import {
  type DevTweaksMockSource,
  type DevTweaksMockState,
  useDevTweaksMock,
} from "@workspace/dev-tweaks";
import { useSetAtom } from "jotai";
import { useEffect } from "react";
import type { AppNotification } from "@/features/shell/app-sidebar-notifications-model";
import {
  notificationReadIdsAtom,
  notificationsDevMockItemsAtom,
} from "@/features/shell/app-sidebar-notifications-store";

/**
 * The Notification Center's Dev Mock: overrides the merged feed with fixture
 * items so the panel can be designed and demoed without a cluster or store.
 * Registered while the App Sidebar is mounted; disabled (the default) hands
 * the panel back to the real feed. Scenario fixtures feeding the real
 * pipeline (fixture CRs and rows) are the display-layer ticket's follow-up.
 */

export const NOTIFICATIONS_DEV_MOCK_KEY = "notifications-mock";

const NOTIFICATIONS_DEV_SCENARIOS = ["mixed", "flood", "all-read"] as const;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MOCK_NOW = Date.now();

function mockItem(
  overrides: Partial<AppNotification> & {
    ago: number;
    id: string;
    kind: AppNotification["kind"];
    title: string;
  }
): AppNotification {
  const { ago, ...rest } = overrides;
  return {
    source: "db",
    timestamp: MOCK_NOW - ago,
    unread: false,
    ...rest,
    id: `db:mock-${rest.id}`,
  };
}

const MIXED_ITEMS: AppNotification[] = [
  mockItem({
    ago: 2 * MINUTE_MS,
    id: "n1",
    kind: "deploy-failure",
    project: "api-server",
    title: "Deployment failed",
    unread: true,
  }),
  mockItem({
    ago: 26 * MINUTE_MS,
    id: "n2",
    kind: "deploy-success",
    project: "web-app",
    title: "Deployment complete",
    unread: true,
  }),
  mockItem({
    ago: HOUR_MS,
    id: "n3",
    kind: "quota",
    title: "Storage quota is full",
    unread: true,
  }),
  mockItem({
    ago: 30 * HOUR_MS,
    id: "n4",
    kind: "billing",
    title: "Free trial ends in 3 days",
  }),
  mockItem({
    ago: 31 * HOUR_MS,
    id: "n5",
    kind: "deploy-success",
    project: "pg-main",
    title: "Database backup finished",
  }),
  mockItem({
    ago: 2 * DAY_MS,
    id: "n6",
    kind: "announcement",
    title: "New: database terminal",
  }),
];

const FLOOD_ITEMS: AppNotification[] = [
  ...MIXED_ITEMS.slice(0, 3),
  mockItem({
    ago: 2 * HOUR_MS,
    id: "n7",
    kind: "deploy-success",
    project: "landing",
    title: "Deployment complete",
    unread: true,
  }),
  mockItem({
    ago: 3 * HOUR_MS,
    id: "n8",
    kind: "deploy-failure",
    project: "worker",
    title: "Deployment failed",
    unread: true,
  }),
  mockItem({
    ago: 4 * HOUR_MS,
    id: "n9",
    kind: "quota",
    title: "CPU quota is full",
    unread: true,
  }),
  mockItem({
    ago: 5 * HOUR_MS,
    id: "n10",
    kind: "billing",
    title: "Balance exhausted",
    unread: true,
  }),
  mockItem({
    ago: 6 * HOUR_MS,
    id: "n11",
    kind: "deploy-success",
    project: "docs",
    title: "Deployment complete",
    unread: true,
  }),
  mockItem({
    ago: 7 * HOUR_MS,
    id: "n12",
    kind: "announcement",
    title: "Scheduled maintenance",
    unread: true,
  }),
  ...MIXED_ITEMS.slice(3),
];

const SCENARIO_ITEMS: Record<string, readonly AppNotification[]> = {
  "all-read": MIXED_ITEMS.map((item) => ({ ...item, unread: false })),
  flood: FLOOD_ITEMS,
  mixed: MIXED_ITEMS,
};

// In-memory source: the mock has no server side and nothing rewrites it
// behind the panel's back, so session-only module state is the whole truth.
let mockState: DevTweaksMockState | null = null;

const notificationsDevMockSource: DevTweaksMockSource = {
  load: () => mockState,
  set: (state) => {
    mockState = state;
  },
};

/** Registers the mock while the App Sidebar is mounted; renders nothing. */
export function AppSidebarNotificationsDevMock() {
  const mock = useDevTweaksMock(NOTIFICATIONS_DEV_MOCK_KEY, {
    note: "Replaces the Notification Center feed with fixture items",
    scenarios: NOTIFICATIONS_DEV_SCENARIOS,
    source: notificationsDevMockSource,
    title: "Notifications mock",
  });
  const setItems = useSetAtom(notificationsDevMockItemsAtom);
  const setReadIds = useSetAtom(notificationReadIdsAtom);

  useEffect(() => {
    setItems(
      mock.enabled ? (SCENARIO_ITEMS[mock.scenario] ?? MIXED_ITEMS) : null
    );
    // A scenario switch is a fresh inbox: optimistic read receipts reset.
    setReadIds(new Set());
  }, [mock.enabled, mock.scenario, setItems, setReadIds]);

  return null;
}
