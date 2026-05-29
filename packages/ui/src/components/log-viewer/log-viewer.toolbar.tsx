"use client";

import { Button } from "@workspace/ui/components/button";
import { FacetedFilterAll } from "@workspace/ui/components/faceted";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@workspace/ui/components/input-group";
import { LivePauseToggle } from "@workspace/ui/components/refresh-controls";
import { TimeRangeSelector } from "@workspace/ui/components/time-range-selector";
import { Box, Download, RefreshCw, Search, Server } from "lucide-react";
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

  return (
    <div className="flex items-center gap-2" data-slot="log-viewer-toolbar">
      {/* Filters */}
      <div className="flex items-center gap-1">
        <FacetedFilterAll
          className="w-28 border-0 shadow-none"
          emptyText="No pods found."
          icon={<Server />}
          label="Pod"
          onValueChange={setSelectedPods}
          options={uniquePods}
          searchPlaceholder="Search pods..."
          showLabel={false}
          value={selectedPods}
        />
        <FacetedFilterAll
          className="w-28 border-0 shadow-none"
          emptyText="No containers found."
          icon={<Box />}
          label="Container"
          onValueChange={setSelectedContainers}
          options={uniqueContainers}
          searchPlaceholder="Search containers..."
          showLabel={false}
          value={selectedContainers}
        />
        <TimeRangeSelector
          className="border-0 shadow-none"
          onChange={setTimeRange}
          value={timeRange}
        />
      </div>

      {/* Search + Actions */}
      <div className="flex flex-1 items-center gap-2">
        <InputGroup className="h-8 flex-1 dark:bg-muted/50">
          <InputGroupAddon>
            <Search className="size-4" />
          </InputGroupAddon>
          <InputGroupInput
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search logs..."
            value={searchQuery}
          />
        </InputGroup>
        {refreshMode === "live" ? (
          <LivePauseToggle
            isLive={isLive}
            onToggle={() => setIsLive(!isLive)}
          />
        ) : (
          <Button
            aria-label="Refresh logs"
            disabled={onRefresh === undefined}
            onClick={onRefresh}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <RefreshCw className="size-4" />
          </Button>
        )}
        <Button
          aria-label="Download logs"
          onClick={() => downloadLogs(filteredEntries)}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <Download className="size-4" />
        </Button>
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
