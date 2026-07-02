"use client";

import { LogViewer } from "@workspace/ui/components/log-viewer/log-viewer";
import type { LogWindow } from "@workspace/ui/components/log-viewer/log-window";
import { Preview, PreviewWrapper } from "@workspace/ui/components/preview";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/vercel-tabs";
import { useState } from "react";

import {
  buildMockLogs,
  LOG_VIEWER_PREVIEW_LIVE_SPAN_MS,
} from "./log-viewer-mock";

export default function LogViewerPreview() {
  const [logs, setLogs] = useState(() => buildMockLogs(Date.now()));
  const [logWindow, setLogWindow] = useState<LogWindow>({
    mode: "live",
    spanMs: LOG_VIEWER_PREVIEW_LIVE_SPAN_MS,
  });

  const handlePreviewReset = () => {
    setLogs(buildMockLogs(Date.now()));
    setLogWindow({ mode: "live", spanMs: LOG_VIEWER_PREVIEW_LIVE_SPAN_MS });
  };

  return (
    <PreviewWrapper className="h-full min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden *:min-h-0 lg:grid-cols-1">
      <Preview
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden"
        containerClassName="max-w-none flex h-full min-h-0 min-w-0 flex-col"
        onReset={handlePreviewReset}
        showReset
        title="Log Viewer"
      >
        <Tabs
          className="flex min-h-0 flex-1 flex-col gap-2"
          defaultValue="logs"
        >
          <TabsList
            aria-label="Preview sections"
            className="shrink-0 flex-wrap"
          >
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="logs">Logs</TabsTrigger>
          </TabsList>
          <TabsContent
            className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
            value="overview"
          >
            <div className="rounded-lg border border-primary/50 border-dashed bg-primary/5 p-3">
              <p className="font-medium text-primary text-xs">
                detail-pane style · Log Viewer preview
              </p>
              <p className="mt-2 text-muted-foreground text-xs">
                Open the <span className="text-foreground">Logs</span> tab for
                the virtualized stream, filters, range, and count chart — same
                pattern as embedding{" "}
                <code className="text-foreground">LogViewer</code> behind canvas
                or detail tabs.
              </p>
            </div>
          </TabsContent>
          <TabsContent
            className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden focus-visible:outline-none"
            value="logs"
          >
            <LogViewer.Variant0
              className="h-full min-h-0 min-w-0 flex-1"
              logs={logs}
              logWindow={logWindow}
              onLogWindowChange={setLogWindow}
            />
          </TabsContent>
        </Tabs>
      </Preview>
    </PreviewWrapper>
  );
}
