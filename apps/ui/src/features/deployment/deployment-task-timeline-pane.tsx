"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible";
import { SidePane } from "@workspace/ui/components/side-pane";
import { cn } from "@workspace/ui/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  LoaderCircle,
  PackageCheck,
  XCircle,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type {
  DeploymentResultResourceCard,
  DeploymentResultResourceCardStatus,
  DeploymentResultResourceRef,
  DeploymentTaskTimelineSnapshot,
  DeploymentTimelineEvent,
  DeploymentTimelineEventSeverity,
  DeploymentTimelineStep,
  DeploymentTimelineStepStatus,
} from "@/lib/deploy-task/timeline";
import type { DeploymentTaskTimelineSnapshotDTO } from "@/lib/deploy-task/types";
import { useDeploymentTaskTimeline } from "@/lib/deploy-task/use-deployment-task-timeline";

interface DeploymentTaskTimelinePaneProps {
  kubeconfig: string;
  namespace: string;
  onClose: () => void;
  taskId: string;
}

function statusTone(
  status: DeploymentTimelineStepStatus | DeploymentResultResourceCardStatus
): string {
  switch (status) {
    case "completed":
    case "running":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "creating":
    case "pending":
      return "border-blue-500/35 bg-blue-500/10 text-blue-700 dark:text-blue-300";
    case "blocked":
    case "unknown":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "failed":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "skipped":
      return "border-border bg-muted text-muted-foreground";
    default:
      return status satisfies never;
  }
}

function statusIcon(
  status: DeploymentTimelineStepStatus | DeploymentResultResourceCardStatus
) {
  switch (status) {
    case "completed":
    case "running":
      return <CheckCircle2 aria-hidden className="size-3.5" />;
    case "creating":
      return <LoaderCircle aria-hidden className="size-3.5 animate-spin" />;
    case "pending":
      return <Clock3 aria-hidden className="size-3.5" />;
    case "blocked":
    case "unknown":
      return <AlertTriangle aria-hidden className="size-3.5" />;
    case "failed":
      return <XCircle aria-hidden className="size-3.5" />;
    case "skipped":
      return <Circle aria-hidden className="size-3.5" />;
    default:
      return status satisfies never;
  }
}

function StatusPill({
  status,
}: {
  status: DeploymentTimelineStepStatus | DeploymentResultResourceCardStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 font-medium text-xs capitalize",
        statusTone(status)
      )}
    >
      {statusIcon(status)}
      {status}
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/30 px-3 py-4 text-muted-foreground text-sm">
      {children}
    </div>
  );
}

function eventSeverityTone(
  severity: DeploymentTimelineEventSeverity | undefined
): string {
  switch (severity) {
    case "success":
      return "bg-emerald-400";
    case "warning":
      return "bg-amber-400";
    case "error":
      return "bg-destructive";
    case "info":
    case undefined:
      return "bg-muted-foreground/60";
    default:
      return severity satisfies never;
  }
}

function TimelineEventList({
  events,
  showSeverity = false,
}: {
  events: readonly DeploymentTimelineEvent[];
  showSeverity?: boolean;
}) {
  if (events.length === 0) {
    return null;
  }
  return (
    <ol className="flex flex-col gap-1.5">
      {events.map((event) => (
        <li
          className={cn(
            "grid gap-2 text-sm",
            showSeverity
              ? "grid-cols-[0.5rem_5rem_minmax(0,1fr)]"
              : "grid-cols-[5rem_minmax(0,1fr)]"
          )}
          key={event.id}
        >
          {showSeverity ? (
            <span
              aria-hidden
              className={cn(
                "mt-2 size-1.5 rounded-full",
                eventSeverityTone(event.severity)
              )}
            />
          ) : null}
          <span className="truncate text-muted-foreground text-xs leading-5">
            {event.createdAt}
          </span>
          <span className="min-w-0 text-foreground leading-5">
            {event.message}
          </span>
        </li>
      ))}
    </ol>
  );
}

function resultResourceKindLabel(ref: DeploymentResultResourceRef): string {
  switch (ref.kind) {
    case "AP":
      return "AP";
    case "DB":
      return "DB";
    case "PublicAccess":
      return "Public access";
    case "TemplateWorkload":
      return ref.workloadKind || "Workload";
    default:
      return ref satisfies never;
  }
}

function defaultResourceCardOpen(
  status: DeploymentResultResourceCardStatus
): boolean {
  return status !== "running";
}

function useResourceCardOpen(status: DeploymentResultResourceCardStatus) {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [autoOpen, setAutoOpen] = useState(() =>
    defaultResourceCardOpen(status)
  );

  useEffect(() => {
    if (manualOpen !== null) {
      return;
    }
    if (defaultResourceCardOpen(status)) {
      setAutoOpen(true);
    }
  }, [manualOpen, status]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setManualOpen(nextOpen);
  }, []);

  return {
    onOpenChange: handleOpenChange,
    open: manualOpen ?? autoOpen,
  };
}

function ResultResourceCard({ card }: { card: DeploymentResultResourceCard }) {
  const { onOpenChange, open } = useResourceCardOpen(card.status);
  const latestEvent = card.events.at(-1);
  const kindLabel = resultResourceKindLabel(card.resultRef);

  return (
    <Collapsible
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-input/30 transition-colors",
        open && "bg-input/40"
      )}
      data-slot="deployment-result-resource-card"
      onOpenChange={onOpenChange}
      open={open}
    >
      <CollapsibleTrigger
        className="group/resource-card flex w-full cursor-pointer flex-col gap-2 px-3 py-3 text-left outline-none transition-colors hover:bg-input/25 focus-visible:ring-2 focus-visible:ring-ring/30"
        type="button"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div
              className="truncate font-medium text-foreground text-sm leading-5"
              title={card.title}
            >
              {card.title}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs leading-4">
              <span>{kindLabel}</span>
              <span>{card.required ? "Required" : "Optional"}</span>
              {card.latestStatusText == null ? null : (
                <span className="min-w-0 truncate">
                  {card.latestStatusText}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusPill status={card.status} />
            <ChevronDown
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open/resource-card:rotate-180"
            />
          </div>
        </div>
        {latestEvent == null ? null : (
          <div className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)] gap-2 text-sm">
            <span className="truncate text-muted-foreground text-xs leading-5">
              {latestEvent.createdAt}
            </span>
            <span className="min-w-0 truncate text-foreground leading-5">
              {latestEvent.message}
            </span>
          </div>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border/70 border-t px-3 py-3 outline-none">
        {card.events.length === 0 ? (
          <p className="text-muted-foreground text-sm leading-5">
            No resource events recorded yet.
          </p>
        ) : (
          <TimelineEventList events={card.events} showSeverity />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function TimelineStepItem({ step }: { step: DeploymentTimelineStep }) {
  const cards = step.resultCards ?? [];
  return (
    <section className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
      <div className="flex flex-col items-center pt-1">
        <span className="size-2.5 rounded-full bg-border" />
        <span className="mt-1 min-h-10 w-px flex-1 bg-border" />
      </div>
      <div className="min-w-0 pb-5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <h3 className="truncate font-medium text-base" title={step.label}>
            {step.label}
          </h3>
          <StatusPill status={step.status} />
        </div>
        <div className="mt-3">
          <TimelineEventList events={step.events} />
        </div>
        {cards.length === 0 ? null : (
          <div className="mt-3 flex flex-col gap-2">
            {cards.map((card) => (
              <ResultResourceCard card={card} key={card.id} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function orderedSteps(
  timeline: DeploymentTaskTimelineSnapshot
): DeploymentTimelineStep[] {
  return [...timeline.steps].sort((a, b) => a.order - b.order);
}

export function DeploymentTaskTimelinePaneContent({
  snapshot,
}: {
  snapshot: DeploymentTaskTimelineSnapshotDTO;
}) {
  const steps = orderedSteps(snapshot.timeline);
  if (steps.length === 0) {
    return <EmptyState>No timeline steps have been declared yet.</EmptyState>;
  }
  return (
    <div className="flex flex-col" data-slot="deployment-task-timeline">
      {steps.map((step) => (
        <TimelineStepItem key={step.id} step={step} />
      ))}
    </div>
  );
}

export function DeploymentTaskTimelinePane({
  kubeconfig,
  namespace,
  onClose,
  taskId,
}: DeploymentTaskTimelinePaneProps) {
  const timeline = useDeploymentTaskTimeline({
    kubeconfig,
    namespace,
    taskId,
  });
  const task = timeline.data?.task;

  return (
    <SidePane
      busy={timeline.isLoading}
      closeAriaLabel="Close deployment task timeline"
      icon={<PackageCheck aria-hidden className="size-4 text-blue-400" />}
      label="Deployment task timeline pane"
      onClose={onClose}
      subtitle={
        task == null
          ? `Task ${taskId}`
          : `${task.status}${task.phase ? ` - ${task.phase}` : ""}`
      }
      title="Deployment Timeline"
    >
      {timeline.error == null ? null : (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {timeline.error.message}
        </div>
      )}
      {timeline.isReconnecting ? (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-muted-foreground text-sm">
          Reconnecting to timeline updates.
        </div>
      ) : null}
      {timeline.data == null ? (
        <EmptyState>Loading deployment timeline.</EmptyState>
      ) : (
        <DeploymentTaskTimelinePaneContent snapshot={timeline.data} />
      )}
    </SidePane>
  );
}
