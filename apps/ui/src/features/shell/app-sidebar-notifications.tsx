"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { useSidebar } from "@workspace/ui/components/sidebar";
import { SlidingToggle } from "@workspace/ui/components/sliding-toggle";
import { cn } from "@workspace/ui/lib/utils";
import {
  Bell,
  CircleAlert,
  ExternalLink,
  Info,
  type LucideIcon,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { recordBillingReturnRoute } from "@/features/billing/billing-return-route";
import { useResolvedBillingCta } from "@/features/billing/use-billing-cta";
import {
  formatNotificationTime,
  formatNotificationTimestamp,
} from "@/features/notifications/notification-time";
import {
  type NotificationFeed,
  useNotificationFeed,
} from "@/features/notifications/use-notification-feed";
import {
  type AppNotification,
  isNotificationUnread,
  type NotificationCTA,
  type NotificationSeverity,
  type NotificationTab,
  notificationBadgeLabel,
  visibleNotifications,
} from "@/features/shell/app-sidebar-notifications-model";
import { useCloseOnSidebarToggle } from "@/features/shell/use-close-on-sidebar-toggle";

/**
 * Severity is marked, never shouted (CONTEXT.md, Notification Severity): the
 * icon and the CTA chip take the semantic color, the same three hues as the
 * Status Hint's tint recipe; the card itself stays neutral at every level.
 */
const SEVERITY_META: Record<
  NotificationSeverity,
  { icon: LucideIcon; tint: string }
> = {
  critical: { icon: CircleAlert, tint: "text-destructive" },
  info: { icon: Info, tint: "text-blue-600 dark:text-blue-400" },
  warning: { icon: TriangleAlert, tint: "text-amber-600 dark:text-amber-400" },
};

function NotificationTime({ timestamp }: { timestamp: number }) {
  return (
    <time
      className="shrink-0 text-[11px] text-muted-foreground tabular-nums"
      dateTime={new Date(timestamp).toISOString()}
      title={formatNotificationTimestamp(timestamp)}
    >
      {formatNotificationTime(timestamp)}
    </time>
  );
}

/**
 * The CTA chip — the Status Hint's tonal recipe, colored by severity. A
 * Desktop-resolved top-up leaves in a new tab; in-app billing hops record
 * the return route first so the Billing Area's close button comes back
 * here. Both count as reading the card.
 */
function NotificationCtaChip({
  cta,
  onRead,
  tint,
}: {
  cta: NotificationCTA;
  onRead: () => void;
  tint: string;
}) {
  const resolved = useResolvedBillingCta(cta);
  const className = cn(
    "ml-[26px] h-6 bg-current/15 px-2 text-xs hover:bg-current/25",
    tint
  );
  if (resolved.external) {
    return (
      <AppButton
        className={className}
        nativeButton={false}
        render={
          <a
            href={resolved.href}
            onClick={onRead}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden data-icon="inline-start" />
            {resolved.label}
          </a>
        }
        size="sm"
        variant="secondary"
      />
    );
  }
  return (
    <AppButton
      className={className}
      nativeButton={false}
      render={
        <Link
          href={resolved.href}
          onClick={() => {
            if (resolved.href.startsWith("/billing")) {
              recordBillingReturnRoute();
            }
            onRead();
          }}
        >
          {resolved.label}
        </Link>
      }
      size="sm"
      variant="secondary"
    />
  );
}

function NotificationCard({
  expanded,
  item,
  onRead,
  onToggle,
  unread,
}: {
  expanded: boolean;
  item: AppNotification;
  onRead: () => void;
  onToggle: () => void;
  unread: boolean;
}) {
  const meta = SEVERITY_META[item.severity];
  const Icon = meta.icon;
  // The CTA is the card's one way out (design spec §10): a sibling link
  // below the message, not a control nested in the row button. Billing CTAs
  // record the return route first so the Billing Area's close button comes
  // back here.
  const cta = item.cta;
  return (
    <div
      className={cn(
        "relative rounded-lg border bg-input/20 transition-colors hover:bg-input/35",
        unread ? "border-border/60" : "border-transparent"
      )}
      data-severity={item.severity}
      data-slot="app-sidebar-notification-row"
    >
      {/* Click = read it: expands a clamped body and marks the item read. */}
      <button
        className="flex w-full cursor-pointer gap-2.5 px-2.5 pt-2.5 text-left"
        onClick={onToggle}
        type="button"
      >
        <Icon
          aria-hidden
          className={cn("mt-0.5 size-4 shrink-0", meta.tint)}
          strokeWidth={1.8}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={cn(
                "min-w-0 truncate text-sm",
                unread ? "font-medium text-neutral-50" : "text-neutral-300"
              )}
            >
              {item.title}
            </span>
            <NotificationTime timestamp={item.timestamp} />
          </span>
          {item.body ? (
            <span
              className={cn(
                "mt-0.5 block text-muted-foreground text-xs leading-relaxed",
                !expanded && "line-clamp-3"
              )}
            >
              {item.body}
            </span>
          ) : null}
        </span>
      </button>
      <div className={cn("px-2.5 pb-2.5", cta == null ? "pt-0" : "pt-2")}>
        {cta == null ? null : (
          <NotificationCtaChip cta={cta} onRead={onRead} tint={meta.tint} />
        )}
      </div>
      <span
        aria-hidden
        className={cn(
          "absolute top-2.5 right-2.5 size-1.5 rounded-full bg-blue-400 transition-opacity",
          unread ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}

function NotificationsEmptyState({ tab }: { tab: NotificationTab }) {
  const nothingYet = tab === "all";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-9 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-input/40">
        <Bell
          aria-hidden
          className="size-4 text-muted-foreground"
          strokeWidth={1.8}
        />
      </span>
      <span className="font-medium text-neutral-50 text-sm">
        {nothingYet ? "No notifications yet" : "You're all caught up"}
      </span>
      <span className="text-muted-foreground text-xs">
        {nothingYet
          ? "Billing, quota, and platform messages land here."
          : "Nothing unread."}
      </span>
    </div>
  );
}

export function NotificationsPanel({ feed }: { feed: NotificationFeed }) {
  const { items, markAllRead, markRead, readIds, unreadCount } = feed;
  const [tab, setTab] = useState<NotificationTab>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set()
  );

  const visible = visibleNotifications(items, tab, readIds);

  const toggle = (item: AppNotification) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
    markRead(item);
  };

  return (
    <>
      <div className="flex h-10 shrink-0 items-center justify-between pr-2 pl-3">
        <span className="font-medium text-sm">Notifications</span>
        <AppButton
          className="text-muted-foreground hover:text-neutral-50"
          disabled={unreadCount === 0}
          onClick={markAllRead}
          size="sm"
          variant="quiet"
        >
          Mark all as read
        </AppButton>
      </div>
      <div className="shrink-0 px-2 pb-2">
        <SlidingToggle
          ariaLabel="Notification filter"
          indicatorClassName="dark:bg-input/40"
          onValueChange={setTab}
          options={[
            { label: "All", value: "all" },
            {
              label: (
                <span className="inline-flex items-center gap-1.5">
                  Unread
                  {unreadCount > 0 ? (
                    <span
                      className="rounded-full bg-blue-400/15 px-1.5 text-[10px] text-blue-400 tabular-nums"
                      data-slot="app-sidebar-notifications-unread-count"
                    >
                      {unreadCount}
                    </span>
                  ) : null}
                </span>
              ),
              value: "unread",
            },
          ]}
          size="sm"
          value={tab}
          width="full"
        />
      </div>
      {visible.length === 0 ? (
        <NotificationsEmptyState tab={tab} />
      ) : (
        <div className="max-h-[30rem] flex-1 overflow-y-auto px-2 pb-2">
          <div className="flex flex-col gap-1.5">
            {visible.map((item) => (
              <NotificationCard
                expanded={expanded.has(item.id)}
                item={item}
                key={item.id}
                onRead={() => markRead(item)}
                onToggle={() => toggle(item)}
                unread={isNotificationUnread(item, readIds)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The Notification Center's App Sidebar entry, directly below the Projects
 * nav row: mirrors AppSidebarNavRow's anatomy (hover pill, w-9 icon slot,
 * fading label) but is a popover trigger with an always-visible unread
 * badge — Expanded shows a count pill, the Collapsed rail a dot on the
 * bell's corner. The panel opens to the right so it never covers the
 * Project rows below.
 */
export function AppSidebarNotifications() {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const feed = useNotificationFeed();
  const { unreadCount } = feed;
  const badgeLabel = notificationBadgeLabel(unreadCount);
  const [open, setOpen] = useState(false);
  // Collapsed anchor: the row keeps its full expanded width under the rail's
  // clipping (same trap as the nav-row tooltips), so the popover anchors the
  // w-9 icon slot instead of the trigger row.
  const iconSlotRef = useRef<HTMLSpanElement>(null);
  useCloseOnSidebarToggle(expanded, () => setOpen(false));

  const trigger = (
    <button
      aria-label={
        unreadCount > 0
          ? `Notifications, ${unreadCount} unread`
          : "Notifications"
      }
      className="group/nbell relative flex h-9 w-full shrink-0 cursor-pointer items-center overflow-hidden rounded-md text-left text-neutral-50 text-sm"
      data-slot="app-sidebar-notifications"
      type="button"
    />
  );

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={trigger}>
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 rounded-md transition-[width,background-color] group-hover/nbell:bg-input/30 motion-reduce:transition-none",
            expanded
              ? "w-full duration-300 ease-sidebar"
              : "w-9 duration-200 ease-out"
          )}
        />
        <span
          className="relative flex w-9 shrink-0 items-center justify-center transition-colors group-hover/nbell:text-blue-400"
          ref={iconSlotRef}
        >
          <Bell aria-hidden className="size-4" strokeWidth={1.8} />
          <span
            aria-hidden
            className={cn(
              "absolute top-2 right-2 size-1.5 rounded-full bg-blue-400 transition-opacity motion-reduce:transition-none",
              !expanded && unreadCount > 0
                ? "opacity-100 duration-200 ease-out"
                : "opacity-0 duration-300 ease-sidebar"
            )}
          />
        </span>
        <span
          className={cn(
            "relative min-w-0 flex-1 truncate whitespace-nowrap pr-2 transition-opacity motion-reduce:transition-none",
            expanded
              ? "opacity-100 duration-300 ease-sidebar"
              : "opacity-0 duration-200 ease-out"
          )}
        >
          Notifications
        </span>
        <span
          className={cn(
            "relative flex shrink-0 items-center pr-2 transition-opacity motion-reduce:transition-none",
            expanded
              ? "opacity-100 duration-300 ease-sidebar"
              : "opacity-0 duration-200 ease-out"
          )}
        >
          {badgeLabel == null ? null : (
            <span
              className="flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-400/15 px-1 font-medium text-[10px] text-blue-400 tabular-nums"
              data-slot="app-sidebar-notifications-badge"
            >
              {badgeLabel}
            </span>
          )}
        </span>
      </PopoverTrigger>
      {/* Collapsed rail: anchor the icon slot, sideOffset 6 (the rail-wide
            convention for popovers) — the default trigger anchor sits at the
            clipped full-width row's edge, far past the visible rail. The
            panel keeps a floor height so an empty inbox and a one-item inbox
            read as the same surface. */}
      <PopoverContent
        align="start"
        anchor={expanded ? undefined : iconSlotRef}
        className="flex min-h-80 w-96 flex-col gap-0 rounded-lg border border-border bg-input/30 p-0 text-brand-primary-foreground shadow-none ring-0 backdrop-blur-xl"
        side="right"
        sideOffset={expanded ? 10 : 6}
      >
        <NotificationsPanel feed={feed} />
      </PopoverContent>
    </Popover>
  );
}
