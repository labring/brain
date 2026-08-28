import type { NotificationCRItem } from "@workspace/api/hooks";

import { MICRO_UNITS_PER_CURRENCY_UNIT } from "@/features/billing/billing-amount";
import type {
  AppNotification,
  NotificationCTA,
  NotificationSeverity,
} from "@/features/shell/app-sidebar-notifications-model";

import { CR_OVERRIDES, GIFT_FILTERED_CR_NAMES } from "./cr-overrides";
import { crNotificationId, dbNotificationId } from "./notification-ids";
import { formatNotificationDate } from "./notification-time";
import type {
  NotificationMessage,
  NotificationPayload,
  QuotaExhaustedResource,
  SubscriptionChange,
} from "./types";

/**
 * The merged-feed seam: platform CRs (`cr:`) and Brain-produced entries
 * (`db:`) become one Notification list sorted by real time, with unread
 * computed from each source's own state and the user's receipts. Pure, so
 * fixture CRs and rows pin contents, order, and unread here.
 */

/** Upstream `spec.from` values written by the platform's billing controllers. */
const BILLING_SENDERS: ReadonlySet<string> = new Set([
  "Debt-System",
  "Workspace-Subscription-System",
]);

/** The low-balance warning tiers: a threshold crossed, nothing suspended yet. */
const WARNING_TIER_CR_NAMES: ReadonlySet<string> = new Set([
  "debt-choice-lowbalanceperiod",
  "debt-choice-criticalbalanceperiod",
]);

/**
 * A platform message's Severity from its fixed name and sender: the debt
 * ladder from `debtperiod` on and every `workspace-debt-*` stage mean
 * something is already suspended or faces deletion (critical); the
 * low-balance tiers and any other billing-controller message warn; anything
 * else is an announcement (info).
 */
export function notificationSeverityForCR(
  item: Pick<NotificationCRItem, "from" | "name">
): NotificationSeverity {
  if (item.name.startsWith("workspace-debt-")) {
    return "critical";
  }
  if (WARNING_TIER_CR_NAMES.has(item.name)) {
    return "warning";
  }
  if (item.name.startsWith("debt-choice-")) {
    return "critical";
  }
  if (item.from != null && BILLING_SENDERS.has(item.from)) {
    return "warning";
  }
  return "info";
}

const QUOTA_RESOURCE_LABELS: Record<QuotaExhaustedResource, string> = {
  cpu: "CPU",
  memory: "Memory",
  nodeport: "Port",
  pod: "Pod",
  storage: "Storage",
};

interface RenderedNotification {
  body: string;
  cta?: NotificationCTA;
  severity: NotificationSeverity;
  title: string;
}

/**
 * The gift's nominal whole-dollar amount (design spec §10 rule 5): the gift
 * is granted in whole dollars and only burns down, so rounding the remainder
 * up recovers the grant a newcomer was told about.
 */
function wholeDollars(microUnits: number): string {
  return `$${Math.max(1, Math.ceil(microUnits / MICRO_UNITS_PER_CURRENCY_UNIT))}`;
}

const SUBSCRIPTION_CHANGE_TITLES: Record<SubscriptionChange, string> = {
  cancelled: "Subscription cancelled",
  downgraded: "Subscription downgraded",
  upgraded: "Subscription upgraded",
};

/** One factual sentence per change type (catalog B5); receipts carry no CTA. */
function subscriptionChangeBody(payload: {
  change: SubscriptionChange;
  effectiveAt?: string;
  planName: string;
}): string {
  const date =
    payload.effectiveAt == null
      ? ""
      : formatNotificationDate(payload.effectiveAt);
  switch (payload.change) {
    case "upgraded":
      return `This workspace is now on ${payload.planName}.`;
    case "downgraded":
      return date === ""
        ? `This workspace moves to ${payload.planName} at the end of the current period.`
        : `This workspace moves to ${payload.planName} on ${date}.`;
    case "cancelled":
      return date === ""
        ? `This workspace's ${payload.planName} subscription ends at the end of the current period.`
        : `This workspace's ${payload.planName} subscription ends on ${date}.`;
    default:
      return payload.change satisfies never;
  }
}

/**
 * Brain-produced entries render from their payload here, client-side; the
 * store holds parameters, never strings. Keyed by kind so the compiler
 * demands a renderer for every producer that lands. Copy from the design
 * spec's inbox table: A1 names the exhausted resource and what it blocks,
 * D4 reassures the newcomer, B5 is a fact-only receipt.
 */
const RENDERERS: {
  [K in NotificationPayload["kind"]]: (
    payload: Extract<NotificationPayload, { kind: K }>
  ) => RenderedNotification;
} = {
  "credit-hint": (payload) => {
    const date =
      payload.expiresAt == null
        ? ""
        : formatNotificationDate(payload.expiresAt);
    return {
      body:
        date === ""
          ? "It covers your first deployments and expires a month after it was granted."
          : `It covers your first deployments and expires on ${date}.`,
      severity: "info",
      title: `You have a ${wholeDollars(payload.giftMicroUnits)} welcome gift`,
    };
  },
  "quota-exhausted": (payload) => {
    const label = QUOTA_RESOURCE_LABELS[payload.resource];
    return {
      body: `${label} is at 100%. New deployments can't start.`,
      cta: { href: "/billing/usage", label: "View usage" },
      severity: "warning",
      title: `${label} quota is full`,
    };
  },
  "subscription-change": (payload) => ({
    body: subscriptionChangeBody(payload),
    severity: "info",
    title: SUBSCRIPTION_CHANGE_TITLES[payload.change],
  }),
};

export function renderNotificationMessage(
  message: NotificationMessage
): RenderedNotification {
  const { payload } = message;
  // The map is exhaustive by construction; the union cannot be correlated
  // with its own key without the cast.
  const render = RENDERERS[payload.kind] as (
    value: NotificationPayload
  ) => RenderedNotification;
  return render(payload);
}

export interface MergeNotificationFeedInput {
  crItems: readonly NotificationCRItem[];
  dbMessages: readonly NotificationMessage[];
  /**
   * The gift-only filter (catalog D1): true hides the low/critical balance
   * tiers for a never-topped-up newcomer holding nothing but gift credit.
   * Absent or false while the account state is unknown — an unknown state
   * never hides a warning.
   */
  giftOnly?: boolean;
  /** Source-prefixed ids the user has read (server receipts). */
  receipts: Iterable<string>;
}

/** The account facts the gift-only filter is decided from. */
export interface GiftOnlyAccountState {
  /** Remaining new-user gift, in micro-units. */
  giftMicroUnits: number;
  /** Whether the account ever recorded a paid top-up. */
  hasToppedUp: boolean;
  /** Every usable credit — gift, plan grant, and anything else. */
  usableMicroUnits: number;
}

/**
 * A never-topped-up account whose available balance is entirely gift credit
 * (design spec §6 D1): no top-up ever, and no credit beyond the gift — a
 * plan grant is not gift. Cash is not consulted: with no top-up on record,
 * any cash balance can only be the platform's legacy gift seed. One top-up
 * disables the filter forever, which the payment history makes permanent by
 * construction.
 */
export function isGiftOnlyNewcomer(state: GiftOnlyAccountState): boolean {
  return !state.hasToppedUp && state.usableMicroUnits <= state.giftMicroUnits;
}

export function platformNotification(
  item: NotificationCRItem,
  receipts: ReadonlySet<string>
): AppNotification {
  const id = crNotificationId(item.name, item.version);
  const override = CR_OVERRIDES[item.name];
  return {
    body: override?.body ?? item.message,
    crName: item.name,
    ...(override == null ? {} : { cta: override.cta }),
    id,
    severity: notificationSeverityForCR(item),
    source: "cr",
    timestamp: item.timestamp * 1000,
    title: override?.title ?? item.title,
    // A platform message is unread iff the label says unread AND the user
    // holds no receipt; upstream auto-read on recovery stacks on top.
    unread: !(item.isRead || receipts.has(id)),
  };
}

export function brainNotification(
  message: NotificationMessage,
  receipts: ReadonlySet<string>
): AppNotification {
  const id = dbNotificationId(message.id);
  const rendered = renderNotificationMessage(message);
  return {
    body: rendered.body,
    ...(rendered.cta == null ? {} : { cta: rendered.cta }),
    id,
    severity: rendered.severity,
    source: "db",
    timestamp: message.createdAt,
    title: rendered.title,
    unread: !receipts.has(id),
  };
}

function compareIds(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** One list, both streams, newest first; ids break ties so order is stable. */
export function mergeNotificationFeed(
  input: MergeNotificationFeedInput
): AppNotification[] {
  const receipts = new Set(input.receipts);
  const crItems =
    input.giftOnly === true
      ? input.crItems.filter((item) => !GIFT_FILTERED_CR_NAMES.has(item.name))
      : input.crItems;
  const items = [
    ...crItems.map((item) => platformNotification(item, receipts)),
    ...input.dbMessages.map((message) => brainNotification(message, receipts)),
  ];
  items.sort((a, b) => b.timestamp - a.timestamp || compareIds(a.id, b.id));
  return items;
}
