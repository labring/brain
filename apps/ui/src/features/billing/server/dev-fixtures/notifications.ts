import type { NotificationCRItem } from "@workspace/api/hooks";

import type { BillingDevScenario } from "@/features/billing/dev-mock-cookie";
import {
  markNotificationReadRequestSchema,
  type NotificationFeedResponse,
  type NotificationMessage,
  type NotificationPayload,
} from "@/features/notifications/types";

import { billingDevMockWorkspace, resolveBillingDevMock } from "./index";

/**
 * Notification Center dev fixtures: while the billing Dev Mock names a
 * scenario, Brain's notification routes answer from here so the inbox can
 * be exercised without a cluster or store. The fixtures feed the real
 * pipeline — fixture platform CRs ride the feed as `platformItems` and the
 * client merges, overrides, and filters them exactly as live ones; Brain
 * rows are ordinary `db:` messages. Each scenario mirrors its billing
 * fixtures (a debt account carries the debt ladder, the gift newcomer the
 * welcome hint, the settled checkout its receipt), so one scenario shapes
 * the Plan view and the inbox together. Read state is session-only memory
 * per scenario; observations answer without writing.
 */

/** Anchored at module load so fixture ids stay stable across polls. */
const FIXTURE_NOW_MS = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const DEBT_SYSTEM = "Debt-System";
const SUBSCRIPTION_SYSTEM = "Workspace-Subscription-System";

interface PlatformFixture {
  ago: number;
  from: string;
  isRead: boolean;
  message: string;
  name: string;
  title: string;
}

interface BrainFixture {
  ago: number;
  payload: NotificationPayload;
}

const ACCOUNT_LADDER = [
  "debt-choice-lowbalanceperiod",
  "debt-choice-criticalbalanceperiod",
  "debt-choice-debtperiod",
  "debt-choice-debtdeletionperiod",
  "debt-choice-finaldeletionperiod",
] as const;

const WORKSPACE_LADDER = [
  "workspace-debt-debt",
  "workspace-debt-debtpredeletion",
  "workspace-debt-debtfinaldeletion",
] as const;

type FixedCRName =
  | (typeof ACCOUNT_LADDER)[number]
  | (typeof WORKSPACE_LADDER)[number];

/** Upstream copy as the platform's controllers actually write it. */
const PLATFORM_COPY: Record<
  FixedCRName,
  Pick<PlatformFixture, "from" | "message" | "title">
> = {
  "debt-choice-criticalbalanceperiod": {
    from: DEBT_SYSTEM,
    message:
      "Your account balance is critically low (under $5). Services will be suspended when it reaches $0.",
    title: "Critical balance",
  },
  "debt-choice-debtdeletionperiod": {
    from: DEBT_SYSTEM,
    message:
      "Your account is still in arrears. Resources will be released soon.",
    title: "Resource release period",
  },
  "debt-choice-debtperiod": {
    from: DEBT_SYSTEM,
    message: "Your account balance is exhausted; services have been suspended.",
    title: "Debt period",
  },
  "debt-choice-finaldeletionperiod": {
    from: DEBT_SYSTEM,
    message: "Radical resource release: all resources may be deleted.",
    title: "Final deletion period",
  },
  "debt-choice-lowbalanceperiod": {
    from: DEBT_SYSTEM,
    message: "Your account balance is below $10. Please recharge in time.",
    title: "Low balance",
  },
  "workspace-debt-debt": {
    from: SUBSCRIPTION_SYSTEM,
    message:
      "The workspace subscription has expired and the workspace is suspended.",
    title: "Workspace debt",
  },
  "workspace-debt-debtfinaldeletion": {
    from: SUBSCRIPTION_SYSTEM,
    message: "Radical resource release: workspace resources may be deleted.",
    title: "Workspace final deletion",
  },
  "workspace-debt-debtpredeletion": {
    from: SUBSCRIPTION_SYSTEM,
    message:
      "The workspace subscription is still unpaid. Resources enter the deletion period.",
    title: "Workspace pre-deletion",
  },
};

/** A debt ladder's rungs, oldest first; at most the named rung is unread. */
function ladder(
  names: readonly FixedCRName[],
  options: { agoDays: readonly number[]; unread?: FixedCRName }
): PlatformFixture[] {
  return names.map((name, index) => ({
    ...PLATFORM_COPY[name],
    ago: (options.agoDays[index] ?? 0) * DAY_MS,
    isRead: name !== options.unread,
    name,
  }));
}

const ANNOUNCEMENT: PlatformFixture = {
  ago: 2 * DAY_MS,
  from: "Admin",
  isRead: false,
  message: "The database terminal is available from every database page.",
  name: "release-notes-2026-08",
  title: "New: database terminal",
};

const UPGRADE_RECEIPT: BrainFixture = {
  ago: DAY_MS,
  payload: {
    change: "upgraded",
    kind: "subscription-change",
    planName: "Hobby",
  },
};

function periodEnd(days: number): string {
  return new Date(FIXTURE_NOW_MS + days * DAY_MS).toISOString();
}

/** The gift was granted with the trial; it runs a month, like the trial. */
const GIFT_HINT: BrainFixture = {
  ago: 3 * HOUR_MS,
  payload: {
    expiresAt: periodEnd(10),
    giftMicroUnits: 1_000_000,
    kind: "credit-hint",
  },
};

interface ScenarioFixture {
  brain: readonly BrainFixture[];
  platform: readonly PlatformFixture[];
}

const EMPTY: ScenarioFixture = { brain: [], platform: [] };

/** One inbox per billing scenario; every catalog row appears somewhere. */
function scenarioFixture(scenario: BillingDevScenario): ScenarioFixture {
  switch (scenario) {
    case "active":
    case "mixed-workspaces":
      return {
        brain: [UPGRADE_RECEIPT],
        platform: [
          ANNOUNCEMENT,
          // A topped-up account keeps its history; the tier is long read.
          ...ladder(["debt-choice-lowbalanceperiod"], { agoDays: [20] }),
        ],
      };
    case "active-balance":
      return {
        brain: [
          {
            ago: 2 * HOUR_MS,
            payload: {
              change: "downgraded",
              effectiveAt: periodEnd(12),
              kind: "subscription-change",
              planName: "Starter",
            },
          },
        ],
        platform: [],
      };
    case "cancelling":
      return {
        brain: [
          {
            ago: HOUR_MS,
            payload: {
              change: "cancelled",
              effectiveAt: periodEnd(12),
              kind: "subscription-change",
              planName: "Hobby",
            },
          },
        ],
        platform: [],
      };
    case "free":
      // The gift newcomer: upstream already tagged the sub-$5 balance, the
      // display layer's gift-only filter hides both tiers.
      return {
        brain: [GIFT_HINT],
        platform: ladder(ACCOUNT_LADDER.slice(0, 2), {
          agoDays: [1, 1],
          unread: "debt-choice-criticalbalanceperiod",
        }),
      };
    // The trial's advance reminders (C1) are upstream's to write; until they
    // ship, an expiring trial's inbox is quiet and the status hint carries
    // the notice alone.
    case "free-expiring":
      return { brain: [], platform: [] };
    case "free-expired":
      return {
        brain: [{ ...GIFT_HINT, ago: 20 * DAY_MS }],
        platform: ladder(WORKSPACE_LADDER.slice(0, 1), {
          agoDays: [2],
          unread: "workspace-debt-debt",
        }),
      };
    case "payg-debt":
      return {
        brain: [],
        platform: ladder(ACCOUNT_LADDER.slice(0, 3), {
          agoDays: [9, 6, 1],
          unread: "debt-choice-debtperiod",
        }),
      };
    case "payg-debt-deletion":
      return {
        brain: [],
        platform: ladder(ACCOUNT_LADDER.slice(0, 4), {
          agoDays: [16, 13, 8, 1],
          unread: "debt-choice-debtdeletionperiod",
        }),
      };
    case "payg-debt-final":
      return {
        brain: [],
        platform: ladder(ACCOUNT_LADDER, {
          agoDays: [23, 20, 15, 8, 1],
          unread: "debt-choice-finaldeletionperiod",
        }),
      };
    case "payment-due":
      return {
        brain: [],
        platform: ladder(WORKSPACE_LADDER.slice(0, 1), {
          agoDays: [2],
          unread: "workspace-debt-debt",
        }),
      };
    case "payment-due-deletion":
      return {
        brain: [],
        platform: ladder(WORKSPACE_LADDER.slice(0, 2), {
          agoDays: [8, 1],
          unread: "workspace-debt-debtpredeletion",
        }),
      };
    case "payment-due-final":
      return {
        brain: [],
        platform: ladder(WORKSPACE_LADDER, {
          agoDays: [16, 9, 2],
          unread: "workspace-debt-debtfinaldeletion",
        }),
      };
    case "quota-full":
      return {
        brain: [
          {
            ago: HOUR_MS,
            payload: {
              kind: "quota-exhausted",
              limit: 20_480,
              resource: "storage",
              used: 20_480,
            },
          },
        ],
        platform: [],
      };
    default:
      return EMPTY;
  }
}

function platformItem(
  fixture: PlatformFixture,
  workspace: string
): NotificationCRItem {
  return {
    desktopPopup: true,
    from: fixture.from,
    importance: "High",
    isRead: fixture.isRead,
    message: fixture.message,
    name: fixture.name,
    namespace: workspace,
    timestamp: Math.floor((FIXTURE_NOW_MS - fixture.ago) / 1000),
    title: fixture.title,
  };
}

function brainMessage(
  fixture: BrainFixture,
  scenario: string,
  index: number
): NotificationMessage {
  return {
    createdAt: FIXTURE_NOW_MS - fixture.ago,
    id: `mock-${scenario}-${index + 1}`,
    kind: fixture.payload.kind,
    payload: fixture.payload,
    projectUid: null,
  };
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

export function notificationDevMockFeed(
  scenario: BillingDevScenario,
  workspace: string
): NotificationFeedResponse {
  const fixture = scenarioFixture(scenario);
  return {
    messages: fixture.brain.map((entry, index) =>
      brainMessage(entry, scenario, index)
    ),
    platformItems: fixture.platform.map((entry) =>
      platformItem(entry, workspace)
    ),
    receipts: [...receiptsFor(scenario)],
  };
}

export type NotificationDevMockHandler = "feed" | "observation" | "read";

/**
 * Answers a notification route from fixtures while the billing Dev Mock is
 * on; null hands the request to the real handler. Observations answer as
 * "nothing new" so the producers never touch the store in mock mode.
 */
export async function notificationDevMockResponse(
  handler: NotificationDevMockHandler,
  request: Request
): Promise<Response | null> {
  const resolution = resolveBillingDevMock(request);
  if (resolution.kind === "off") {
    return null;
  }
  if (resolution.kind === "invalid") {
    return resolution.response;
  }
  const { scenario } = resolution;
  switch (handler) {
    case "feed": {
      const workspace = billingDevMockWorkspace(
        new URL(request.url).searchParams.get("namespace")
      );
      return Response.json(notificationDevMockFeed(scenario, workspace));
    }
    case "read": {
      const parsed = markNotificationReadRequestSchema.safeParse(
        await request.json().catch(() => null)
      );
      if (!parsed.success) {
        return Response.json(
          { error: "Invalid mark-read request." },
          { status: 400 }
        );
      }
      const receipts = receiptsFor(scenario);
      for (const id of parsed.data.ids) {
        receipts.add(id);
      }
      return Response.json({ read: parsed.data.ids });
    }
    case "observation":
      return Response.json({ produced: false, released: [] });
    default:
      return handler satisfies never;
  }
}
