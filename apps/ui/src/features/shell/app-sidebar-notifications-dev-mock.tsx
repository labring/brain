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
  appNotificationsAtom,
  notificationReadIdsAtom,
} from "@/features/shell/app-sidebar-notifications-store";

/**
 * The Notification Center's Dev Mock: fills the notifications store with
 * fixture items so the panel can be designed and demoed before a real feed
 * exists. Registered while the App Sidebar is mounted; disabled (the
 * default) leaves the store empty — the shipped empty state.
 */

export const NOTIFICATIONS_DEV_MOCK_KEY = "notifications-mock";

const NOTIFICATIONS_DEV_SCENARIOS = ["mixed", "flood", "all-read"] as const;

const MIXED_ITEMS: AppNotification[] = [
  {
    id: "n1",
    kind: "deploy-failure",
    project: "api-server",
    time: "2m ago",
    title: "Deployment failed",
    unread: true,
  },
  {
    id: "n2",
    kind: "deploy-success",
    project: "web-app",
    time: "26m ago",
    title: "Deployment complete",
    unread: true,
  },
  {
    id: "n3",
    kind: "quota",
    time: "1h ago",
    title: "Memory quota at 82%",
    unread: true,
  },
  {
    id: "n4",
    kind: "billing",
    time: "Yesterday",
    title: "Free trial ends in 3 days",
    unread: false,
  },
  {
    id: "n5",
    kind: "deploy-success",
    project: "pg-main",
    time: "Yesterday",
    title: "Database backup finished",
    unread: false,
  },
  {
    id: "n6",
    kind: "announcement",
    time: "2d ago",
    title: "New: database terminal",
    unread: false,
  },
];

const FLOOD_ITEMS: AppNotification[] = [
  ...MIXED_ITEMS.slice(0, 3),
  {
    id: "n7",
    kind: "deploy-success",
    project: "landing",
    time: "3h ago",
    title: "Deployment complete",
    unread: true,
  },
  {
    id: "n8",
    kind: "quota",
    time: "6h ago",
    title: "Storage quota at 91%",
    unread: true,
  },
  ...MIXED_ITEMS.slice(3),
  {
    id: "n9",
    kind: "deploy-failure",
    project: "redis-cache",
    time: "2d ago",
    title: "Workload restarted",
    unread: false,
  },
  {
    id: "n10",
    kind: "billing",
    time: "3d ago",
    title: "Invoice ready",
    unread: false,
  },
  {
    id: "n11",
    kind: "announcement",
    time: "5d ago",
    title: "New: GitHub deployments",
    unread: false,
  },
  {
    id: "n12",
    kind: "deploy-success",
    project: "docs-site",
    time: "6d ago",
    title: "Deployment complete",
    unread: false,
  },
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
    note: "Fills the Notification Center with fixture items",
    scenarios: NOTIFICATIONS_DEV_SCENARIOS,
    source: notificationsDevMockSource,
    title: "Notifications mock",
  });
  const setItems = useSetAtom(appNotificationsAtom);
  const setReadIds = useSetAtom(notificationReadIdsAtom);

  useEffect(() => {
    setItems(
      mock.enabled ? (SCENARIO_ITEMS[mock.scenario] ?? MIXED_ITEMS) : []
    );
    // A scenario switch is a fresh inbox: session read receipts reset with it.
    setReadIds(new Set());
  }, [mock.enabled, mock.scenario, setItems, setReadIds]);

  return null;
}
