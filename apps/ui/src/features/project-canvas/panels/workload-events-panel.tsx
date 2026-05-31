"use client";

import {
  type APWorkloadEventItem,
  useAPWorkloadEvents,
} from "@workspace/api/hooks";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { CalendarDays } from "lucide-react";
import { memo, useMemo } from "react";

import { containerStatesFromNode } from "@/features/project-canvas/flow/container-node-workload";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import { CanvasResourcePane } from "./canvas-resource-pane";

const EVENT_LIMIT = 50;
const RELATIVE_TIME_FORMAT = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
});

function eventTimestamp(event: APWorkloadEventItem): string {
  return event.lastTimestamp ?? event.firstTimestamp ?? "";
}

function formatEventAge(timestamp: string): string {
  if (timestamp.trim() === "") {
    return "";
  }
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) {
    return "";
  }
  const seconds = Math.round((time - Date.now()) / 1000);
  const absSeconds = Math.abs(seconds);
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

function WorkloadEventCard({ event }: { event: APWorkloadEventItem }) {
  const age = formatEventAge(eventTimestamp(event));
  const resource = eventResourceLabel(event);

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg bg-resource-pane-card p-4 shadow-sm">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="truncate font-medium text-base text-resource-pane-foreground leading-6">
            {event.reason || "Event"}
          </h3>
          {resource === "" ? null : (
            <p className="truncate text-resource-pane-muted text-xs leading-4">
              {resource}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-resource-pane-muted text-sm leading-5">
          {event.type ? <span>{event.type}</span> : null}
          {age ? <span>{age}</span> : null}
        </div>
      </div>
      <p className="text-resource-pane-muted text-sm leading-5">
        {event.message || "No event message."}
      </p>
      {event.count && event.count > 1 ? (
        <p className="text-resource-pane-muted text-xs leading-4">
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
      <div className="rounded-lg bg-resource-pane-card p-4 text-resource-pane-muted text-sm leading-5">
        Failed to load events.
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="rounded-lg bg-resource-pane-card p-4 text-resource-pane-muted text-sm leading-5">
        Loading events...
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-lg bg-resource-pane-card p-4 text-resource-pane-muted text-sm leading-5">
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
  const subtitle =
    items.length === 1
      ? "Instance scheduling, startup, and health check events. 1 Item"
      : `Instance scheduling, startup, and health check events. ${items.length} Items`;

  return (
    <CanvasResourcePane
      bodyClassName="gap-5"
      closeAriaLabel="Close workload events"
      icon={
        <CalendarDays aria-hidden className="size-4 shrink-0 text-blue-500" />
      }
      onClose={onClose}
      subtitle={subtitle}
      title={`${name} Events`}
    >
      <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-resource-pane-input p-2.5">
        <WorkloadEventsBody error={error} isLoading={isLoading} items={items} />
      </section>
    </CanvasResourcePane>
  );
});

WorkloadEventsPane.displayName = "WorkloadEventsPane";
