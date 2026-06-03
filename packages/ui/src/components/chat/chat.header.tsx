"use client";

import {
  Add01Icon,
  FileExportIcon,
  Setting07Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AppIconButton,
  type AppIconButtonProps,
} from "@workspace/ui/components/app-icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Spinner } from "@workspace/ui/components/spinner";
import { chatScrollbarThinClass } from "@workspace/ui/lib/chat-scrollbar";
import { cn } from "@workspace/ui/lib/utils";
import type { UIMessage } from "ai";
import { ChevronDown, PanelRightClose } from "lucide-react";
import { type ComponentProps, useMemo } from "react";

import type { ChatHeaderThreadHistory } from "./chat.types";

/** Safe filename stem for downloads (falls back when empty after sanitizing). */
function chatExportFileStem(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim() ?? "";
  const stem =
    trimmed.length === 0
      ? fallback
      : trimmed
          .slice(0, 120)
          .replace(/[^\p{L}\p{N}\-_]+/gu, "-")
          .replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : fallback;
}

/**
 * Downloads the transcript as formatted JSON (`exportedAt`, `messageCount`, `messages`).
 * Host typically wires this to `ChatHeaderExport` (`Chat.Export`) `onExport`.
 */
export function downloadChatMessagesJson(
  messages: readonly UIMessage[],
  options?: { fileNameStem?: string }
): void {
  const fileNameStem = chatExportFileStem(
    options?.fileNameStem,
    "chat-transcript"
  );
  const payload = {
    exportedAt: new Date().toISOString(),
    messageCount: messages.length,
    messages: [...messages],
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileNameStem}.json`;
    a.rel = "noopener";
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

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

export type ChatHeaderExportProps = Omit<
  AppIconButtonProps,
  "aria-label" | "children" | "onClick" | "size" | "type" | "variant"
> & {
  "aria-label"?: string;
  onExport?: () => void;
};

/** Export control; pass `onExport` from the host. */
export function ChatHeaderExport({
  "aria-label": ariaLabel = "Export",
  className,
  onExport,
  ...props
}: ChatHeaderExportProps) {
  return (
    <AppIconButton
      aria-label={ariaLabel}
      className={className}
      disabled={onExport === undefined}
      onClick={() => onExport?.()}
      size="lg"
      type="button"
      variant="quiet"
      {...props}
    >
      <HugeiconsIcon icon={FileExportIcon} size={16} strokeWidth={2} />
    </AppIconButton>
  );
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
      {busy ? (
        <Spinner aria-hidden />
      ) : (
        <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={2} />
      )}
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
      <HugeiconsIcon icon={Setting07Icon} size={16} strokeWidth={2} />
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
  const historyItems = threadHistory?.items ?? [];
  const visibleHistoryItems = useMemo(
    () => historyItems.filter((item) => !item.referential),
    [historyItems]
  );
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
          className="hoverable flex max-w-full cursor-pointer items-center gap-1 rounded-md px-1 py-0.5 font-medium text-foreground text-sm outline-none disabled:pointer-events-none disabled:cursor-default disabled:opacity-100"
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
        <DropdownMenuContent align="start" className="max-wlg min-w-xs">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Threads</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canPickHistory ? (
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
                {visibleHistoryItems.map((item) => (
                  <DropdownMenuRadioItem
                    className="min-w-0 text-xs/relaxed"
                    closeOnClick
                    key={item.id}
                    value={item.id}
                  >
                    <span className="flex min-w-0 flex-1 items-center justify-between gap-3 pr-1">
                      <span
                        className="min-w-0 shrink truncate"
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      <span className="shrink-0 text-muted-foreground tabular-nums">
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
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export type ChatHeaderProps = ComponentProps<"header"> & {
  threadHistory?: ChatHeaderThreadHistory;
  threadName: string;
};

/** Single-line header: thread title + host-composed controls (`Chat.Export`, `Chat.NewThread`, …). */
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
ChatHeaderExport.displayName = "Chat.Export";
ChatHeaderNewThread.displayName = "Chat.NewThread";
ChatHeaderSetting.displayName = "Chat.Setting";
ChatHeaderClosePane.displayName = "Chat.ClosePane";
ChatHeader.displayName = "Chat.Header";
