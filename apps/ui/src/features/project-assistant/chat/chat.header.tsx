"use client";

import {
  AppIconButton,
  type AppIconButtonProps,
} from "@workspace/ui/components/app-icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Spinner } from "@workspace/ui/components/spinner";
import { chatScrollbarThinClass } from "@workspace/ui/lib/chat-scrollbar";
import { cn } from "@workspace/ui/lib/utils";
import { ChevronDown, PanelRightClose, Plus, Settings2 } from "lucide-react";
import { type ComponentProps, useMemo, useState } from "react";

import type { ChatHeaderThreadHistory } from "./chat.types";

const COLLAPSED_THREAD_HISTORY_LIMIT = 5;

function formatThreadDropdownTimestamp(source: string | number | Date): string {
  const d = new Date(source);
  if (Number.isNaN(d.getTime())) {
    return "";
  }

  const now = new Date();
  const today =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const clock: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };

  if (today) {
    return new Intl.DateTimeFormat(undefined, clock).format(d);
  }

  const sameYearAsNow = d.getFullYear() === now.getFullYear();
  const datePart: Intl.DateTimeFormatOptions = sameYearAsNow
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" };

  return new Intl.DateTimeFormat(undefined, { ...datePart, ...clock }).format(
    d
  );
}

function collapsedThreadHistoryItems(
  items: ChatHeaderThreadHistory["items"],
  activeThreadId: string
) {
  if (items.length <= COLLAPSED_THREAD_HISTORY_LIMIT) {
    return items;
  }

  const firstItems = items.slice(0, COLLAPSED_THREAD_HISTORY_LIMIT);
  if (firstItems.some((item) => item.id === activeThreadId)) {
    return firstItems;
  }

  const activeItem = items.find((item) => item.id === activeThreadId);
  if (!activeItem) {
    return firstItems;
  }

  return [
    activeItem,
    ...items
      .filter((item) => item.id !== activeThreadId)
      .slice(0, COLLAPSED_THREAD_HISTORY_LIMIT - 1),
  ];
}

export type ChatHeaderNewThreadProps = Omit<
  AppIconButtonProps,
  "aria-label" | "children" | "onClick" | "size" | "type" | "variant"
> & {
  "aria-label"?: string;
  /** When true, shows `Spinner` in place of the add icon while the handler runs. */
  creating?: boolean;
  onNewThread?: () => void;
};

/** New thread control; pass `onNewThread` from the host. */
export function ChatHeaderNewThread({
  className,
  creating = false,
  onNewThread,
  disabled = false,
  "aria-label": ariaLabel = "New thread",
  ...props
}: ChatHeaderNewThreadProps) {
  const busy = Boolean(creating);

  return (
    <AppIconButton
      {...props}
      aria-busy={busy}
      aria-label={busy ? "Creating thread" : ariaLabel}
      className={className}
      disabled={busy || disabled || onNewThread === undefined}
      onClick={() => onNewThread?.()}
      size="lg"
      type="button"
      variant="quiet"
    >
      {busy ? <Spinner aria-hidden /> : <Plus className="size-4" />}
    </AppIconButton>
  );
}

export type ChatHeaderSettingProps = Omit<
  AppIconButtonProps,
  "aria-label" | "children" | "onClick" | "size" | "type" | "variant"
> & {
  "aria-label"?: string;
  onSettings?: () => void;
};

/** Settings control; omitted `onSettings` renders nothing. */
export function ChatHeaderSetting({
  "aria-label": ariaLabel = "Settings",
  className,
  onSettings,
  ...props
}: ChatHeaderSettingProps) {
  if (!onSettings) {
    return null;
  }

  return (
    <AppIconButton
      aria-label={ariaLabel}
      className={className}
      onClick={onSettings}
      size="lg"
      type="button"
      variant="quiet"
      {...props}
    >
      <Settings2 className="size-4" />
    </AppIconButton>
  );
}

export type ChatHeaderClosePaneProps = Omit<
  AppIconButtonProps,
  "aria-label" | "children" | "onClick" | "size" | "type" | "variant"
> & {
  "aria-label"?: string;
  onClosePane: () => void;
};

/** Close / collapse pane (e.g. assistant sidebar); host supplies `onClosePane`. */
export function ChatHeaderClosePane({
  className,
  onClosePane,
  "aria-label": ariaLabel = "Close panel",
  ...props
}: ChatHeaderClosePaneProps) {
  return (
    <AppIconButton
      aria-label={ariaLabel}
      className={className}
      onClick={onClosePane}
      size="lg"
      type="button"
      variant="quiet"
      {...props}
    >
      <PanelRightClose aria-hidden className="size-4" strokeWidth={2} />
    </AppIconButton>
  );
}

export type ChatThreadSelectProps = ComponentProps<"div"> & {
  threadHistory?: ChatHeaderThreadHistory;
  threadName: string;
};

/** Thread title; becomes a selector when `threadHistory` is passed. */
export function ChatThreadSelect({
  className,
  threadHistory,
  threadName,
  ...props
}: ChatThreadSelectProps) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const historyItems = threadHistory?.items;
  const activeThreadId = threadHistory?.activeThreadId;
  const visibleHistoryItems = useMemo(
    () => (historyItems ?? []).filter((item) => !item.referential),
    [historyItems]
  );
  const hasOverflowingHistory =
    visibleHistoryItems.length > COLLAPSED_THREAD_HISTORY_LIMIT;
  const renderedHistoryItems = useMemo(() => {
    if (!activeThreadId || historyExpanded) {
      return visibleHistoryItems;
    }

    return collapsedThreadHistoryItems(visibleHistoryItems, activeThreadId);
  }, [activeThreadId, historyExpanded, visibleHistoryItems]);
  const canPickHistory = threadHistory && visibleHistoryItems.length > 0;

  if (!threadHistory) {
    return (
      <div
        className={cn(
          "min-w-0 flex-1 truncate pl-1 font-medium text-foreground text-sm",
          className
        )}
        data-slot="chat-thread-title"
        {...props}
      >
        {threadName}
      </div>
    );
  }

  return (
    <div
      className={cn("min-w-0 flex-1 overflow-hidden pl-1", className)}
      data-slot="chat-thread-select"
      {...props}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Select thread"
          className="flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 font-medium text-foreground text-sm outline-none disabled:pointer-events-none disabled:cursor-default disabled:opacity-100"
          disabled={!canPickHistory}
          type="button"
        >
          <span className="min-w-0 truncate">{threadName}</span>
          {canPickHistory ? (
            <ChevronDown
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
              strokeWidth={2}
            />
          ) : null}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-72 max-w-96 border border-border bg-input/30 p-1 text-foreground shadow-none ring-0 backdrop-blur-xl"
        >
          {canPickHistory ? (
            <>
              <DropdownMenuRadioGroup
                className={cn(
                  "max-h-[300px] overflow-y-auto",
                  chatScrollbarThinClass
                )}
                defaultValue={threadHistory.activeThreadId}
                key={threadHistory.activeThreadId}
                onValueChange={(v) => {
                  if (v) {
                    threadHistory.onSelect(v);
                  }
                }}
              >
                {renderedHistoryItems.map((item) => (
                  <DropdownMenuRadioItem
                    className="min-w-0 cursor-pointer gap-2 rounded-sm py-1.5 pr-2 pl-2 text-popover-foreground text-sm leading-5 focus:bg-input/30 focus:text-popover-foreground focus:**:text-popover-foreground data-[checked]:bg-input data-highlighted:bg-input/30 data-[checked]:text-popover-foreground [&_[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
                    closeOnClick
                    key={item.id}
                    value={item.id}
                  >
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                      <span
                        className="min-w-px flex-1 truncate text-left"
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      <span className="shrink-0 text-popover-foreground/60 text-xs tabular-nums leading-4">
                        {item.updatedAtSource == null
                          ? item.updatedAt
                          : formatThreadDropdownTimestamp(
                              item.updatedAtSource
                            ) || item.updatedAt}
                      </span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {hasOverflowingHistory ? (
                <button
                  aria-expanded={historyExpanded}
                  className="mt-1 flex h-4 w-full cursor-pointer items-center justify-center rounded-sm px-2 text-popover-foreground/70 text-xs leading-none outline-none hover:bg-input/30 hover:text-popover-foreground focus-visible:bg-input/30 focus-visible:text-popover-foreground"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setHistoryExpanded((current) => !current);
                  }}
                  type="button"
                >
                  {historyExpanded ? "Show less" : "Show all"}
                </button>
              ) : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export type ChatHeaderProps = ComponentProps<"header"> & {
  threadHistory?: ChatHeaderThreadHistory;
  threadName: string;
};

/** Single-line header: thread title + host-composed controls (`Chat.NewThread`, …). */
export function ChatHeader({
  className,
  children,
  threadHistory,
  threadName,
  ...props
}: ChatHeaderProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center justify-between gap-1 border-border border-b p-2",
        className
      )}
      data-slot="chat-header"
      {...props}
    >
      <ChatThreadSelect threadHistory={threadHistory} threadName={threadName} />
      <div
        className="flex min-w-0 shrink-0 items-center"
        data-slot="chat-header-actions"
      >
        {children}
      </div>
    </header>
  );
}

ChatThreadSelect.displayName = "Chat.ThreadSelect";
ChatHeaderNewThread.displayName = "Chat.NewThread";
ChatHeaderSetting.displayName = "Chat.Setting";
ChatHeaderClosePane.displayName = "Chat.ClosePane";
ChatHeader.displayName = "Chat.Header";
