import type {
  WorkloadLogEntry,
  WorkloadLogsResponse,
  WorkloadLogsTarget,
  WorkloadLogsWindow,
} from "@workspace/api/hooks";
import type { LogEntry } from "@workspace/ui/components/log-viewer/log-viewer.context";
import {
  DEFAULT_LIVE_SPAN_MS,
  type LogWindow,
  logWindowBounds,
} from "@workspace/ui/components/log-viewer/log-window";

export const RESOURCE_LOGS_DEFAULT_LIMIT = 500;
export const RESOURCE_LOGS_POLL_INTERVAL_MS = 3000;

export const RESOURCE_LOGS_DEFAULT_WINDOW: LogWindow = {
  mode: "live",
  spanMs: DEFAULT_LIVE_SPAN_MS,
};

export function resourceLogsWindow(
  logWindow: LogWindow,
  now = new Date()
): WorkloadLogsWindow {
  return logWindowBounds(logWindow, now);
}

export function resourceLogsWindowKey(logWindow: LogWindow): string {
  if (logWindow.mode === "frozen") {
    return `${logWindow.start.toISOString()}-${logWindow.end.toISOString()}`;
  }
  return `live-${logWindow.spanMs}`;
}

export function resourceLogsRefreshIntervalMs(logWindow: LogWindow): number {
  return logWindow.mode === "live" ? RESOURCE_LOGS_POLL_INTERVAL_MS : 0;
}

export function resourceLogsTruncatedAt(
  entries: LogEntry[]
): number | undefined {
  return entries.length >= RESOURCE_LOGS_DEFAULT_LIMIT
    ? RESOURCE_LOGS_DEFAULT_LIMIT
    : undefined;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function entryTime(entry: WorkloadLogEntry): string {
  const raw = stringField(entry.time ?? entry._time);
  if (raw !== "") {
    return raw;
  }
  return new Date(0).toISOString();
}

function entryMessage(entry: WorkloadLogEntry): string {
  const raw = entry.message ?? entry._msg;
  if (typeof raw === "string") {
    return raw;
  }
  return raw == null ? "" : String(raw);
}

export function workloadLogsToLogEntries(
  data: WorkloadLogsResponse | undefined
): LogEntry[] {
  if (data === undefined) {
    return [];
  }
  // No sorting here: LogViewerProvider owns the oldest-to-newest invariant.
  return Object.values(data).flatMap((group) =>
    Array.isArray(group)
      ? group.map((entry) => ({
          container: stringField(entry.container),
          message: entryMessage(entry),
          node: stringField(entry.node),
          pod: stringField(entry.pod),
          stream: stringField(entry.stream),
          time: entryTime(entry),
        }))
      : []
  );
}

export function resourceLogsTarget(options: {
  kind: WorkloadLogsTarget["kind"];
  name: string | undefined;
  namespace: string | undefined;
}): WorkloadLogsTarget | null {
  const name = options.name?.trim() ?? "";
  const namespace = options.namespace?.trim() ?? "";
  if (name === "" || namespace === "") {
    return null;
  }
  return { kind: options.kind, name, namespace };
}
