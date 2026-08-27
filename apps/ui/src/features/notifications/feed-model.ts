import type { NotificationCRItem } from "@workspace/api/hooks";

import type {
  AppNotification,
  AppNotificationKind,
  AppNotificationSource,
} from "@/features/shell/app-sidebar-notifications-model";

import { dbNotificationId } from "./notification-ids";
import type {
  NotificationMessage,
  NotificationPayload,
  QuotaExhaustedResource,
} from "./types";

/**
 * The merged-feed seam: platform CRs (`cr:`) and Brain-produced entries
 * (`db:`) become one Notification list sorted by real time, with unread
 * computed from each source's own state and the user's receipts. Pure, so
 * fixture CRs and rows pin contents, order, and unread here.
 */

/**
 * A platform notification's id is versioned by the CR's own timestamp: the
 * platform overwrites fixed-name CRs in place on escalation, and the newer
 * timestamp makes the revived message a new id that no old receipt covers.
 */
export function crNotificationId(name: string, timestamp: number): string {
  return `cr:${name}:${timestamp}`;
}

export function notificationSource(id: string): AppNotificationSource | null {
  if (id.startsWith("cr:")) {
    return "cr";
  }
  if (id.startsWith("db:")) {
    return "db";
  }
  return null;
}

/** Upstream `spec.from` values written by the platform's billing controllers. */
const BILLING_SENDERS: ReadonlySet<string> = new Set([
  "Debt-System",
  "Workspace-Subscription-System",
]);

export function notificationKindForCR(
  item: Pick<NotificationCRItem, "from" | "name">
): AppNotificationKind {
  if (
    (item.from != null && BILLING_SENDERS.has(item.from)) ||
    item.name.startsWith("debt-choice-") ||
    item.name.startsWith("workspace-debt-")
  ) {
    return "billing";
  }
  return "announcement";
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
  kind: AppNotificationKind;
  title: string;
}

/**
 * Brain-produced entries render from their payload here, client-side; the
 * store holds parameters, never strings. Keyed by kind so the compiler
 * demands a renderer for every producer that lands. Copy direction from the
 * catalog (A1): name the exhausted resource and what it blocks.
 */
const RENDERERS: {
  [K in NotificationPayload["kind"]]: (
    payload: Extract<NotificationPayload, { kind: K }>
  ) => RenderedNotification;
} = {
  "quota-exhausted": (payload) => {
    const label = QUOTA_RESOURCE_LABELS[payload.resource];
    return {
      body: `New deployments can't start until you free up ${label.toLowerCase()} or raise the limit.`,
      kind: "quota",
      title: `${label} quota is full`,
    };
  },
};

export function renderNotificationMessage(
  message: NotificationMessage
): RenderedNotification {
  return RENDERERS[message.payload.kind](message.payload);
}

export interface MergeNotificationFeedInput {
  crItems: readonly NotificationCRItem[];
  dbMessages: readonly NotificationMessage[];
  /** Source-prefixed ids the user has read (server receipts). */
  receipts: Iterable<string>;
}

export function platformNotification(
  item: NotificationCRItem,
  receipts: ReadonlySet<string>
): AppNotification {
  const id = crNotificationId(item.name, item.timestamp);
  return {
    body: item.message,
    crName: item.name,
    id,
    kind: notificationKindForCR(item),
    source: "cr",
    timestamp: item.timestamp * 1000,
    title: item.title,
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
    id,
    kind: rendered.kind,
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
  const items = [
    ...input.crItems.map((item) => platformNotification(item, receipts)),
    ...input.dbMessages.map((message) => brainNotification(message, receipts)),
  ];
  items.sort((a, b) => b.timestamp - a.timestamp || compareIds(a.id, b.id));
  return items;
}
