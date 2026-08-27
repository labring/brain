"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { useSidebar } from "@workspace/ui/components/sidebar";
import { cn } from "@workspace/ui/lib/utils";
import {
  Bell,
  CheckCheck,
  CircleCheck,
  CircleX,
  CreditCard,
  Gauge,
  type LucideIcon,
  Megaphone,
} from "lucide-react";
import { useRef, useState } from "react";
import { formatNotificationTime } from "@/features/notifications/notification-time";
import {
  type NotificationFeed,
  useNotificationFeed,
} from "@/features/notifications/use-notification-feed";
import { AppSidebarNotificationsDevMockGate } from "@/features/shell/app-sidebar-notifications-dev-mock-gate";
import {
  type AppNotification,
  type AppNotificationKind,
  isNotificationUnread,
  type NotificationTab,
  notificationBadgeLabel,
  visibleNotifications,
} from "@/features/shell/app-sidebar-notifications-model";
import { useCloseOnSidebarToggle } from "@/features/shell/use-close-on-sidebar-toggle";

const KIND_META: Record<
  AppNotificationKind,
  { icon: LucideIcon; tint: string }
> = {
  announcement: { icon: Megaphone, tint: "text-blue-400" },
  billing: { icon: CreditCard, tint: "text-neutral-300" },
  "deploy-failure": { icon: CircleX, tint: "text-red-400" },
  "deploy-success": { icon: CircleCheck, tint: "text-emerald-400" },
  quota: { icon: Gauge, tint: "text-amber-400" },
};

function NotificationKindIcon({ kind }: { kind: AppNotificationKind }) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-input/40">
      <Icon
        aria-hidden
        className={cn("size-3.5", meta.tint)}
        strokeWidth={1.8}
      />
    </span>
  );
}

function NotificationRow({
  item,
  onRead,
  unread,
}: {
  item: AppNotification;
  onRead: () => void;
  unread: boolean;
}) {
  const meta = [item.project, formatNotificationTime(item.timestamp)]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-2 text-left transition-colors hover:bg-input/30"
      data-slot="app-sidebar-notification-row"
      onClick={onRead}
      type="button"
    >
      <NotificationKindIcon kind={item.kind} />
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-sm",
            unread ? "font-medium text-neutral-50" : "text-neutral-300"
          )}
        >
          {item.title}
        </span>
        <span className="mt-0.5 block truncate text-muted-foreground text-xs">
          {meta}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full bg-blue-400",
          unread ? "opacity-100" : "opacity-0"
        )}
      />
    </button>
  );
}

function NotificationsEmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-9 text-center">
      <span className="flex size-9 items-center justify-center rounded-full bg-input/40">
        <Bell
          aria-hidden
          className="size-4 text-muted-foreground"
          strokeWidth={1.8}
        />
      </span>
      <span className="font-medium text-neutral-50 text-sm">
        No notifications
      </span>
      <span className="text-muted-foreground text-xs">
        You're all caught up.
      </span>
    </div>
  );
}

function NotificationsPanel({ feed }: { feed: NotificationFeed }) {
  const { items, markAllRead, markRead, readIds, unreadCount } = feed;
  const [tab, setTab] = useState<NotificationTab>("all");

  const visible = visibleNotifications(items, tab, readIds);

  return (
    <>
      <div className="flex h-9 shrink-0 items-center justify-between pr-1.5 pl-3">
        <span className="font-medium text-sm">Notifications</span>
        <button
          aria-label="Mark all as read"
          className={cn(
            "flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-input/40 hover:text-neutral-50",
            unreadCount === 0 && "pointer-events-none opacity-40"
          )}
          onClick={markAllRead}
          type="button"
        >
          <CheckCheck aria-hidden className="size-3.5" strokeWidth={1.8} />
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1 px-3 pb-2">
        {(
          [
            { key: "all", label: "All" },
            {
              key: "unread",
              label: unreadCount > 0 ? `Unread ${unreadCount}` : "Unread",
            },
          ] as const
        ).map((entry) => (
          <button
            className={cn(
              "cursor-pointer rounded-md px-2 py-1 text-xs transition-colors",
              tab === entry.key
                ? "bg-input/40 font-medium text-neutral-50"
                : "text-muted-foreground hover:text-neutral-50"
            )}
            key={entry.key}
            onClick={() => setTab(entry.key)}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <NotificationsEmptyState />
      ) : (
        <div className="max-h-88 overflow-y-auto px-1.5 pb-1.5">
          <div className="flex flex-col">
            {visible.map((item) => (
              <NotificationRow
                item={item}
                key={item.id}
                onRead={() => markRead(item)}
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
    <>
      <AppSidebarNotificationsDevMockGate />
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
            clipped full-width row's edge, far past the visible rail. */}
        <PopoverContent
          align="start"
          anchor={expanded ? undefined : iconSlotRef}
          className="w-80 gap-0 rounded-lg border border-border bg-input/30 p-0 text-brand-primary-foreground shadow-none ring-0 backdrop-blur-xl"
          side="right"
          sideOffset={expanded ? 10 : 6}
        >
          <NotificationsPanel feed={feed} />
        </PopoverContent>
      </Popover>
    </>
  );
}
