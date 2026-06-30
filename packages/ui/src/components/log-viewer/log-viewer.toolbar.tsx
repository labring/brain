"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { AppMultiSelect } from "@workspace/ui/components/app-select";
import { LivePauseToggle } from "@workspace/ui/components/refresh-controls";
import { TimeRangeSelector } from "@workspace/ui/components/time-range-selector";
import { Box, Download, RefreshCw, Search, Server } from "lucide-react";
import { useMemo } from "react";
import { type LogEntry, useLogViewerContext } from "./log-viewer.context";

export function LogViewerToolbar() {
  const {
    searchQuery,
    setSearchQuery,
    isLive,
    setIsLive,
    filteredEntries,
    timeRange,
    setTimeRange,
    selectedPods,
    setSelectedPods,
    uniquePods,
    selectedContainers,
    setSelectedContainers,
    uniqueContainers,
    onRefresh,
    refreshMode,
  } = useLogViewerContext();
  const podOptions = useMemo(
    () => uniquePods.map((pod) => ({ label: pod, value: pod })),
    [uniquePods]
  );
  const containerOptions = useMemo(
    () =>
      uniqueContainers.map((container) => ({
        label: container,
        value: container,
      })),
    [uniqueContainers]
  );

  return (
    <div className="flex items-center gap-2" data-slot="log-viewer-toolbar">
      {/* Filters */}
      <div className="flex items-center gap-1">
        <AppMultiSelect
          aria-label="Filter pods"
          className="w-36"
          emptyMessage="No pods found."
          icon={<Server />}
          onValueChange={setSelectedPods}
          options={podOptions}
          placeholder="Pod"
          searchPlaceholder="Search"
          value={selectedPods}
        />
        <AppMultiSelect
          aria-label="Filter containers"
          className="w-40"
          emptyMessage="No containers found."
          icon={<Box />}
          onValueChange={setSelectedContainers}
          options={containerOptions}
          placeholder="Container"
          searchPlaceholder="Search"
          value={selectedContainers}
        />
        <TimeRangeSelector onChange={setTimeRange} value={timeRange} />
      </div>

      {/* Search + Actions */}
      <div className="flex flex-1 items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <AppInput
            aria-label="Search logs"
            className="h-9 pl-8 shadow-xs"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            type="search"
            value={searchQuery}
          />
        </div>
        {refreshMode === "live" ? (
          <LivePauseToggle
            disabled={onRefresh === undefined}
            isLive={isLive}
            onToggle={() => setIsLive(!isLive)}
          />
        ) : (
          <AppIconButton
            aria-label="Refresh logs"
            disabled={onRefresh === undefined}
            onClick={onRefresh}
            size="lg"
            type="button"
            variant="secondary"
          >
            <RefreshCw className="size-4" />
          </AppIconButton>
        )}
        <AppIconButton
          aria-label="Download logs"
          onClick={() => downloadLogs(filteredEntries)}
          size="lg"
          type="button"
          variant="secondary"
        >
          <Download className="size-4" />
        </AppIconButton>
      </div>
    </div>
  );
}

function downloadLogs(entries: LogEntry[]) {
  const header = "time\tpod\tcontainer\tmessage";
  const lines = entries.map(
    (e) => `${e.time}\t${e.pod}\t${e.container}\t${e.message}`
  );
  const blob = new Blob([`${header}\n${lines.join("\n")}`], {
    type: "text/plain",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `logs-${new Date().toISOString().slice(0, 19)}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
