import type { NotificationCRItem } from "@workspace/api/hooks";

import { resolveDevMock } from "@/features/dev-mock/server/resolve";
import { DAY_MS, HOUR_MS } from "@/lib/time";

import {
  type NotificationsDevScenario,
  notificationsDevMockCookie,
} from "./dev-mock-cookie";
import { crNotificationId } from "./notification-ids";
import {
  markNotificationReadRequestSchema,
  type NotificationFeedResponse,
  notificationFeedResponseSchema,
} from "./types";

/**
 * Platform-origin Notification fixtures (the `cr:` stream): announcements,
 * deployment outcomes, and database events as the platform's controllers
 * would write them. They ride the feed as `platformItems`, so the client
 * takes them instead of polling the cluster and merges, sorts, and marks
 * them read exactly as live CRs. The billing-born ladder stays the billing
 * mock's; this layer only ever appends. Read state is session-only memory
 * per scenario.
 */

/** Anchored at module load so fixture ids stay stable across polls. */
const FIXTURE_NOW_MS = Date.now();

const ADMIN = "Admin";
const DEPLOYMENT_SYSTEM = "Deployment-System";
const DATABASE_SYSTEM = "Database-System";

interface PlatformFixture {
  ago: number;
  from: string;
  isRead: boolean;
  message: string;
  name: string;
  title: string;
}

const ANNOUNCEMENTS: readonly Omit<PlatformFixture, "ago" | "isRead">[] = [
  {
    from: ADMIN,
    message:
      "Open a terminal on any database from its page — no client install needed.",
    name: "announce-db-terminal",
    title: "New: database terminal",
  },
  {
    from: ADMIN,
    message:
      "Deployments now show a step-by-step timeline with the failing step called out.",
    name: "announce-deploy-timeline",
    title: "New: deployment timeline",
  },
  {
    from: ADMIN,
    message:
      "Scheduled maintenance on Sunday 02:00–04:00 UTC. Running workloads are not affected.",
    name: "announce-maintenance-window",
    title: "Scheduled maintenance",
  },
  {
    from: ADMIN,
    message: "Custom domains can now be verified with a single CNAME record.",
    name: "announce-custom-domains",
    title: "Simpler custom domains",
  },
  {
    from: ADMIN,
    message:
      "Workspace members can be invited by email from the workspace settings.",
    name: "announce-invites",
    title: "Invite by email",
  },
  {
    from: ADMIN,
    message: "Node pools were upgraded; new pods start on the faster nodes.",
    name: "announce-node-upgrade",
    title: "Faster nodes",
  },
];

const DEPLOYMENTS: readonly Omit<PlatformFixture, "ago" | "isRead">[] = [
  {
    from: DEPLOYMENT_SYSTEM,
    message: "web-app is live on 2 replicas from main@4f1c2a9.",
    name: "deploy-web-app-succeeded",
    title: "web-app deployed",
  },
  {
    from: DEPLOYMENT_SYSTEM,
    message:
      "api-server failed at the build step: `go build` exited with status 2.",
    name: "deploy-api-server-failed",
    title: "api-server deployment failed",
  },
  {
    from: DEPLOYMENT_SYSTEM,
    message: "landing is live from main@b77e0d1.",
    name: "deploy-landing-succeeded",
    title: "landing deployed",
  },
  {
    from: DEPLOYMENT_SYSTEM,
    message:
      "image-worker is waiting for a storage volume to bind; it will continue on its own.",
    name: "deploy-image-worker-blocked",
    title: "image-worker deployment waiting",
  },
  {
    from: DEPLOYMENT_SYSTEM,
    message: "docs-site is live from main@91aa3c0.",
    name: "deploy-docs-site-succeeded",
    title: "docs-site deployed",
  },
  {
    from: DEPLOYMENT_SYSTEM,
    message:
      "auth-service rolled back to the previous image after a failed health check.",
    name: "deploy-auth-service-rolled-back",
    title: "auth-service rolled back",
  },
  {
    from: DEPLOYMENT_SYSTEM,
    message: "analytics is live on 1 replica from main@0c4d7e2.",
    name: "deploy-analytics-succeeded",
    title: "analytics deployed",
  },
  {
    from: DEPLOYMENT_SYSTEM,
    message: "cron-runner deployment was cancelled before the build finished.",
    name: "deploy-cron-runner-cancelled",
    title: "cron-runner deployment cancelled",
  },
];

const DB_EVENTS: readonly Omit<PlatformFixture, "ago" | "isRead">[] = [
  {
    from: DATABASE_SYSTEM,
    message: "The nightly backup of pg-main completed (1.2 GB).",
    name: "db-pg-main-backup-completed",
    title: "pg-main backup completed",
  },
  {
    from: DATABASE_SYSTEM,
    message:
      "redis-cache restarted after exceeding its memory limit; data in memory was lost.",
    name: "db-redis-cache-restarted",
    title: "redis-cache restarted",
  },
  {
    from: DATABASE_SYSTEM,
    message: "pg-main storage is at 85% of its volume. Consider resizing.",
    name: "db-pg-main-storage-warning",
    title: "pg-main storage almost full",
  },
  {
    from: DATABASE_SYSTEM,
    message: "search-index was restored from the backup taken 3 days ago.",
    name: "db-search-index-restored",
    title: "search-index restored",
  },
];

function spread(
  entries: readonly Omit<PlatformFixture, "ago" | "isRead">[],
  options: { firstAgo: number; step: number; unread: number }
): PlatformFixture[] {
  return entries.map((entry, index) => ({
    ...entry,
    ago: options.firstAgo + index * options.step,
    isRead: index >= options.unread,
  }));
}

/** One inbox per scenario, newest first. */
function scenarioFixture(
  scenario: NotificationsDevScenario
): PlatformFixture[] {
  switch (scenario) {
    case "announcement":
      return spread(ANNOUNCEMENTS.slice(0, 1), {
        firstAgo: 2 * DAY_MS,
        step: 0,
        unread: 1,
      });
    case "deployment":
      return spread(DEPLOYMENTS.slice(0, 2), {
        firstAgo: HOUR_MS,
        step: 2 * HOUR_MS,
        unread: 2,
      });
    case "db-event":
      return spread(DB_EVENTS.slice(0, 1), {
        firstAgo: 5 * HOUR_MS,
        step: 0,
        unread: 1,
      });
    case "mixed": {
      // Thirty days of traffic, interleaved by time, only the newest unread.
      const items = [
        ...spread(DEPLOYMENTS, {
          firstAgo: HOUR_MS,
          step: 3.5 * DAY_MS,
          unread: 2,
        }),
        ...spread(DB_EVENTS, {
          firstAgo: 5 * HOUR_MS,
          step: 7 * DAY_MS,
          unread: 1,
        }),
        ...spread(ANNOUNCEMENTS, {
          firstAgo: 2 * DAY_MS,
          step: 5 * DAY_MS,
          unread: 0,
        }),
      ];
      return items.sort((a, b) => a.ago - b.ago);
    }
    default:
      return scenario satisfies never;
  }
}

function platformItem(
  fixture: PlatformFixture,
  workspace: string
): NotificationCRItem {
  const seconds = Math.floor((FIXTURE_NOW_MS - fixture.ago) / 1000);
  return {
    desktopPopup: true,
    from: fixture.from,
    importance: fixture.from === ADMIN ? "Medium" : "High",
    isRead: fixture.isRead,
    message: fixture.message,
    name: fixture.name,
    namespace: workspace,
    timestamp: seconds,
    title: fixture.title,
    version: seconds,
  };
}

export function platformNotificationDevMockItems(
  scenario: NotificationsDevScenario,
  workspace: string
): NotificationCRItem[] {
  return scenarioFixture(scenario).map((entry) =>
    platformItem(entry, workspace)
  );
}

// Session-only read state, one inbox per scenario; nothing persists.
const receiptsByScenario = new Map<string, Set<string>>();

function receiptsFor(scenario: string): Set<string> {
  let receipts = receiptsByScenario.get(scenario);
  if (receipts == null) {
    receipts = new Set();
    receiptsByScenario.set(scenario, receipts);
  }
  return receipts;
}

function fixtureIds(
  scenario: NotificationsDevScenario,
  workspace: string
): Set<string> {
  return new Set(
    platformNotificationDevMockItems(scenario, workspace).map((item) =>
      crNotificationId(item.name, item.version)
    )
  );
}

export type PlatformNotificationDevMockHandler =
  | "feed"
  | "observation"
  | "read";

/** The next layer down: the billing mock's fixtures or the real handler. */
export type NotificationDevMockNext = (request: Request) => Promise<Response>;

/** The feed the mock answers alone when the layer below is unavailable. */
function standaloneFeed(
  scenario: NotificationsDevScenario,
  workspace: string
): NotificationFeedResponse {
  return {
    messages: [],
    platformItems: platformNotificationDevMockItems(scenario, workspace),
    receipts: [...receiptsFor(scenario)],
  };
}

async function feedResponse(
  scenario: NotificationsDevScenario,
  request: Request,
  next: NotificationDevMockNext
): Promise<Response> {
  const workspace =
    new URL(request.url).searchParams.get("namespace")?.trim() || "ns-mock";
  const below = await next(request);
  if (!below.ok) {
    return Response.json(standaloneFeed(scenario, workspace));
  }
  const parsed = notificationFeedResponseSchema.safeParse(
    await below.json().catch(() => null)
  );
  if (!parsed.success) {
    return Response.json(standaloneFeed(scenario, workspace));
  }
  const body: NotificationFeedResponse = {
    messages: parsed.data.messages,
    platformItems: [
      ...(parsed.data.platformItems ?? []),
      ...platformNotificationDevMockItems(scenario, workspace),
    ],
    receipts: [...new Set([...parsed.data.receipts, ...receiptsFor(scenario)])],
  };
  return Response.json(body);
}

async function readResponse(
  scenario: NotificationsDevScenario,
  request: Request,
  next: NotificationDevMockNext
): Promise<Response> {
  const parsed = markNotificationReadRequestSchema.safeParse(
    await request
      .clone()
      .json()
      .catch(() => null)
  );
  if (!parsed.success) {
    return next(request);
  }
  const workspace =
    new URL(request.url).searchParams.get("namespace")?.trim() || "ns-mock";
  const owned = fixtureIds(scenario, workspace);
  const mine = parsed.data.ids.filter((id) => owned.has(id));
  const rest = parsed.data.ids.filter((id) => !owned.has(id));
  const receipts = receiptsFor(scenario);
  for (const id of mine) {
    receipts.add(id);
  }
  if (rest.length === 0) {
    return Response.json({ read: mine });
  }
  if (mine.length === 0) {
    return next(request);
  }
  const forwarded = new Request(request, {
    body: JSON.stringify({ ids: rest }),
  });
  const below = await next(forwarded);
  if (!below.ok) {
    return below;
  }
  const payload: unknown = await below.json().catch(() => null);
  const read =
    typeof payload === "object" &&
    payload != null &&
    Array.isArray((payload as { read?: unknown }).read)
      ? ((payload as { read: string[] }).read ?? [])
      : rest;
  return Response.json({ read: [...mine, ...read] });
}

/**
 * Layers the platform fixtures over whatever answers below — the billing
 * mock's feed or the real handler: the feed gains the fixture `cr:` items,
 * a mark-read for fixture ids is kept in memory and the rest forwarded,
 * observations pass straight through. Off hands the request down untouched.
 */
export function withPlatformNotificationDevMock(
  handler: PlatformNotificationDevMockHandler,
  request: Request,
  next: NotificationDevMockNext
): Promise<Response> {
  const resolution = resolveDevMock(
    notificationsDevMockCookie,
    request,
    "Notification Center"
  );
  if (resolution.kind === "off") {
    return next(request);
  }
  if (resolution.kind === "invalid") {
    return Promise.resolve(resolution.response);
  }
  const { scenario } = resolution;
  switch (handler) {
    case "feed":
      return feedResponse(scenario, request, next);
    case "read":
      return readResponse(scenario, request, next);
    case "observation":
      return next(request);
    default:
      return handler satisfies never;
  }
}
