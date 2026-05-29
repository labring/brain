import type {
  WorkloadLogEntry,
  WorkloadLogsResponse,
  WorkloadLogsTarget,
  WorkloadLogsWindow,
} from "@workspace/api/hooks";
import type { LogEntry } from "@workspace/ui/components/log-viewer/log-viewer.context";
import type { TimeRange } from "@workspace/ui/components/time-range-selector";

export const RESOURCE_LOGS_DEFAULT_RANGE_MS = 60 * 60 * 1000;
export const RESOURCE_LOGS_DEFAULT_LIMIT = 500;

export const RESOURCE_LOGS_DEFAULT_TIME_RANGE: TimeRange = {
  mode: "quick",
  ms: RESOURCE_LOGS_DEFAULT_RANGE_MS,
};

export function resourceLogsWindow(
  range: TimeRange,
  now = new Date()
): WorkloadLogsWindow {
  if (range.mode === "custom") {
    return { end: range.end, start: range.start };
  }
  return {
    end: now,
    start: new Date(now.getTime() - range.ms),
  };
}

export function resourceLogsWindowKey(range: TimeRange): string {
  if (range.mode === "custom") {
    return `${range.start.toISOString()}-${range.end.toISOString()}`;
  }
  return `last-${range.ms}`;
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
  const entries = Object.values(data).flatMap((group) =>
    group.map((entry) => ({
      container: stringField(entry.container),
      message: entryMessage(entry),
      node: stringField(entry.node),
      pod: stringField(entry.pod),
      stream: stringField(entry.stream),
      time: entryTime(entry),
    }))
  );
  return entries.sort((a, b) => b.time.localeCompare(a.time));
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
