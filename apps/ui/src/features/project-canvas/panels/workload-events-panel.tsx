"use client";

import {
  type APWorkloadEventItem,
  useAPWorkloadEvents,
} from "@workspace/api/hooks";
import { cn } from "@workspace/ui/lib/utils";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { CalendarDays } from "lucide-react";
import { memo, useMemo } from "react";

import { containerStatesFromNode } from "@/features/project-canvas/flow/container-node-workload";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import { CanvasResourcePane } from "./canvas-resource-pane";

export const EVENT_LIMIT = 50;
const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});
const EVENT_ABSOLUTE_TIME_THRESHOLD_DAYS = 7;
const EVENT_ABSOLUTE_TIME_THRESHOLD_SECONDS =
  EVENT_ABSOLUTE_TIME_THRESHOLD_DAYS * 24 * 60 * 60;
const EVENT_ABSOLUTE_DATE_FORMAT = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
});
const EVENT_ABSOLUTE_TIME_FORMAT = new Intl.DateTimeFormat("en", {
  hour: "numeric",
  minute: "2-digit",
});

function formatAbsoluteEventTime(eventDate: Date, nowDate: Date): string {
  const date = EVENT_ABSOLUTE_DATE_FORMAT.format(eventDate);
  const time = EVENT_ABSOLUTE_TIME_FORMAT.format(eventDate);
  if (eventDate.getFullYear() === nowDate.getFullYear()) {
    return `${date}, ${time}`;
  }
  return `${date}, ${eventDate.getFullYear()}, ${time}`;
}

export type WorkloadEventsSubtitleState = "error" | "loading" | "ready";

export function eventTimestamp(event: APWorkloadEventItem): string {
  return event.lastTimestamp ?? event.firstTimestamp ?? "";
}

export function formatEventAge(timestamp: string, now = Date.now()): string {
  if (timestamp.trim() === "") {
    return "";
  }
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return "";
  }
  const seconds = Math.round((time - now) / 1000);
  const absSeconds = Math.abs(seconds);
  if (seconds < 0 && absSeconds >= EVENT_ABSOLUTE_TIME_THRESHOLD_SECONDS) {
    const eventDate = new Date(time);
    const nowDate = new Date(now);
    return formatAbsoluteEventTime(eventDate, nowDate);
  }
  if (absSeconds < 60) {
    return RELATIVE_TIME_FORMAT.format(seconds, "second");
  }
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) {
    return RELATIVE_TIME_FORMAT.format(minutes, "minute");
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return RELATIVE_TIME_FORMAT.format(hours, "hour");
  }
  const days = Math.round(hours / 24);
  return RELATIVE_TIME_FORMAT.format(days, "day");
}

export function formatLoadedEventCount(
  count: number,
  limit = EVENT_LIMIT
): string {
  if (count === 1) {
    return "1 Item";
  }
  if (count >= limit) {
    return `Latest ${limit}`;
  }
  return `${count} Items`;
}

export function formatWorkloadEventsSubtitle({
  count,
  limit = EVENT_LIMIT,
  state,
}: {
  count: number;
  limit?: number;
  state: WorkloadEventsSubtitleState;
}): string {
  let status = formatLoadedEventCount(count, limit);
  if (state === "loading") {
    status = "Loading";
  }
  if (state === "error") {
    status = "Unavailable";
  }
  return `Instance scheduling, startup, and health check events. ${status}`;
}

function eventResourceLabel(event: APWorkloadEventItem): string {
  const { kind, name } = event.involvedObject;
  if (!(kind || name)) {
    return "";
  }
  if (!kind) {
    return name ?? "";
  }
  if (!name) {
    return kind;
  }
  return `${kind} ${name}`;
}

export function workloadEventTypeClassName(type: string | undefined): string {
  switch (type?.trim().toLowerCase()) {
    case "normal":
      return "text-green-500";
    case "warning":
      return "text-yellow-500";
    default:
      return "text-muted-foreground";
  }
}

function formatEventStatus(event: APWorkloadEventItem): string {
  const age = formatEventAge(eventTimestamp(event));
  return [event.type, age].filter((part) => part && part !== "").join(" ");
}

export function WorkloadEventCard({ event }: { event: APWorkloadEventItem }) {
  const status = formatEventStatus(event);
  const resource = eventResourceLabel(event);

  return (
    <article className="flex min-w-0 flex-col gap-4 overflow-hidden rounded-lg bg-input/30 p-4 shadow-sm">
      <header className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="truncate font-medium text-foreground text-sm leading-5">
            {event.reason || "Event"}
          </h3>
          {resource === "" ? null : (
            <p className="truncate text-muted-foreground text-xs leading-4">
              {resource}
            </p>
          )}
        </div>
        {status === "" ? null : (
          <p
            className={cn(
              "max-w-60 shrink-0 text-right text-xs leading-4",
              workloadEventTypeClassName(event.type)
            )}
          >
            {status}
          </p>
        )}
      </header>
      <div className="h-px w-full shrink-0 bg-border" />
      <p className="text-muted-foreground text-sm leading-5">
        {event.message || "No event message."}
      </p>
      {event.count && event.count > 1 ? (
        <p className="text-right text-muted-foreground text-xs leading-4">
          Repeated {event.count} times
        </p>
      ) : null}
    </article>
  );
}

function workloadEventKey(event: APWorkloadEventItem): string {
  return [
    event.involvedObject.kind ?? "resource",
    event.involvedObject.name ?? "unknown",
    event.reason,
    event.type ?? "",
    event.message,
    eventTimestamp(event),
    String(event.count ?? 0),
  ].join(":");
}

function WorkloadEventsBody({
  error,
  isLoading,
  items,
}: {
  error: unknown;
  isLoading: boolean;
  items: APWorkloadEventItem[];
}) {
  if (error) {
    return (
      <div className="rounded-lg bg-input/30 p-4 text-muted-foreground text-sm leading-5">
        Failed to load events.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="rounded-lg bg-input/30 p-4 text-muted-foreground text-sm leading-5">
        Loading events...
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-lg bg-input/30 p-4 text-muted-foreground text-sm leading-5">
        No recent events.
      </div>
    );
  }
  return items.map((event) => (
    <WorkloadEventCard event={event} key={workloadEventKey(event)} />
  ));
}

export const WorkloadEventsPane = memo(function WorkloadEventsPane({
  node,
  onClose,
}: {
  node: Node;
  onClose: () => void;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const ns = useAtomValue(namespaceAtom).trim();
  const states = containerStatesFromNode(node);
  const name = states?.name ?? "Workload";
  const namespace = states?.namespace?.trim() || ns;
  const target = useMemo(
    () => (states?.name && namespace ? { name: states.name, namespace } : null),
    [namespace, states?.name]
  );
  const { data, error, isLoading } = useAPWorkloadEvents({
    kubeconfig,
    limit: EVENT_LIMIT,
    target,
  });
  const items = data?.items ?? [];
  let subtitleState: WorkloadEventsSubtitleState = "ready";
  if (error) {
    subtitleState = "error";
  } else if (isLoading && data == null) {
    subtitleState = "loading";
  }
  const subtitle = formatWorkloadEventsSubtitle({
    count: items.length,
    state: subtitleState,
  });

  return (
    <CanvasResourcePane
      bodyClassName="gap-5"
      closeAriaLabel="Close workload events"
      icon={
        <CalendarDays aria-hidden className="size-4 shrink-0 text-blue-400" />
      }
      onClose={onClose}
      subtitle={subtitle}
      title={`${name} Events`}
    >
      <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-2.5">
        <WorkloadEventsBody error={error} isLoading={isLoading} items={items} />
      </section>
    </CanvasResourcePane>
  );
});

WorkloadEventsPane.displayName = "WorkloadEventsPane";
