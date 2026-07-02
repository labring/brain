"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";
import { type LogsData, LogViewerProvider } from "./log-viewer.context";
import { LogViewerCountChart } from "./log-viewer.count-chart";
import { LogViewerListContent, LogViewerListHeader } from "./log-viewer.list";
import { LogViewerLivePill } from "./log-viewer.live-control";
import { LogViewerToolbar } from "./log-viewer.toolbar";
import type { LogWindow } from "./log-window";

function LogViewerRoot({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-1 flex-col gap-2 overflow-hidden p-1",
        className
      )}
      data-slot="log-viewer"
    >
      {children}
    </div>
  );
}

function LogViewerList({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border",
        className
      )}
      data-slot="log-viewer-list"
    >
      {children}
      <LogViewerLivePill />
    </div>
  );
}

function LogViewerVariant0({
  logs,
  className,
  logWindow,
  onLogWindowChange,
  searchQuery,
  onSearchQueryChange,
  truncatedAt,
}: {
  logs: LogsData;
  className?: string;
  logWindow?: LogWindow;
  onLogWindowChange?: (logWindow: LogWindow) => void;
  searchQuery?: string;
  onSearchQueryChange?: (q: string) => void;
  truncatedAt?: number;
}) {
  return (
    <LogViewerProvider
      externalLogWindow={logWindow}
      externalSearchQuery={searchQuery}
      logs={logs}
      onLogWindowChange={onLogWindowChange}
      onSearchQueryChange={onSearchQueryChange}
      truncatedAt={truncatedAt}
    >
      <LogViewerRoot className={className}>
        <LogViewerToolbar />
        <LogViewerCountChart />
        <LogViewerList>
          <LogViewerListHeader />
          <LogViewerListContent />
        </LogViewerList>
      </LogViewerRoot>
    </LogViewerProvider>
  );
}

export const LogViewer = {
  Provider: LogViewerProvider,
  Root: LogViewerRoot,
  Toolbar: LogViewerToolbar,
  CountChart: LogViewerCountChart,
  List: LogViewerList,
  ListHeader: LogViewerListHeader,
  ListContent: LogViewerListContent,
  Variant0: LogViewerVariant0,
};
