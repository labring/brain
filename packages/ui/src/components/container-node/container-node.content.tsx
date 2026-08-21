"use client";

import { ProjectSourceDockerIcon } from "@workspace/ui/assets/project-source-icons";
import {
  CanvasNode,
  type CanvasNodeMetricListItem,
} from "@workspace/ui/components/canvas-node/canvas-node";
import { canvasNodeActionWithAvailability } from "@workspace/ui/components/canvas-node/canvas-node.availability";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  Activity,
  CalendarDays,
  Cpu,
  FileText,
  Layers,
  ListTree,
  MemoryStick,
  Pause,
  Play,
  RotateCcw,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import {
  containerNodeLifecycleAvailability,
  containerNodeQuickActionAvailability,
} from "./container-node.availability";
import { useContainerNode } from "./container-node.context";
import { resolveContainerNodeStatus } from "./container-node.status";
import type {
  ContainerNodeLifecycleActionKey,
  ContainerNodeMetricKey,
  ContainerNodeQuickActionKey,
  ContainerNodeStates,
} from "./container-node.types";

const METRIC_ITEMS = [
  { icon: Cpu, key: "cpu", label: "CPU" },
  { icon: MemoryStick, key: "memory", label: "Memory" },
] as const satisfies readonly CanvasNodeMetricListItem<ContainerNodeMetricKey>[];

const QUICK_ACTION_ITEMS = [
  {
    icon: Activity,
    key: "metrics",
    label: "Open workload metrics",
    tooltip: "Workload metrics",
  },
  {
    icon: SquareTerminal,
    key: "terminal",
    label: "Open terminal",
    tooltip: "Terminal",
  },
  { icon: FileText, key: "logs", label: "Open logs", tooltip: "Logs" },
  {
    icon: CalendarDays,
    key: "calendar",
    label: "Open deployments",
    tooltip: "Deployments",
  },
  {
    icon: ListTree,
    key: "events",
    label: "Open workload events",
    tooltip: "Workload events",
  },
] as const satisfies readonly {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  key: ContainerNodeQuickActionKey;
  label: string;
  tooltip: string;
}[];

interface LifecycleActionItem {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  key: ContainerNodeLifecycleActionKey;
  label: string;
  tone?: "destructive" | "info" | "muted" | "success";
}

const LIFECYCLE_ACTION_ITEMS: readonly LifecycleActionItem[] = [
  { icon: Play, key: "start", label: "Start", tone: "success" },
  { icon: Pause, key: "stop", label: "Stop", tone: "muted" },
  { icon: RotateCcw, key: "restart", label: "Restart", tone: "info" },
  { icon: Trash2, key: "delete", label: "Delete", tone: "destructive" },
] as const;

function formatContainerSubtitle(kind: string | undefined) {
  const resolvedKind = kind?.trim() || "AP";

  if (resolvedKind.toUpperCase() === "AP") {
    return "Container";
  }

  return `${resolvedKind} workload`;
}

function finiteReplicaCount(input: number | undefined): number | undefined {
  return typeof input === "number" && Number.isFinite(input)
    ? input
    : undefined;
}

/**
 * Ready pods lead the metric. While ready and desired differ (scaling,
 * rollout, degraded), the desired count rides along as `ready/desired`;
 * once converged the metric collapses back to one number.
 */
function formatContainerReplicas(
  replicas: number | undefined,
  readyReplicas: number | undefined
) {
  const desired = finiteReplicaCount(replicas);
  const ready = finiteReplicaCount(readyReplicas);
  if (ready === undefined) {
    return desired === undefined ? "--" : String(desired);
  }
  if (desired === undefined || ready === desired) {
    return String(ready);
  }
  return `${ready}/${desired}`;
}

export function ContainerNodeContent({
  metricsContent,
}: {
  metricsContent?: ReactNode;
}) {
  return (
    <CanvasNode.Card surfaceClassName="container-node-surface">
      <CanvasNode.Header>
        <ContainerNodeHeaderContent />
      </CanvasNode.Header>
      <CanvasNode.Body>
        <ContainerNodeBodyContent />
      </CanvasNode.Body>
      <CanvasNode.Footer>
        <ContainerNodeFooterContent metricsContent={metricsContent} />
      </CanvasNode.Footer>
    </CanvasNode.Card>
  );
}

export function ContainerNodeHeaderContent({
  className,
}: {
  className?: string;
}) {
  const {
    state: { states },
  } = useContainerNode();
  const subtitle = formatContainerSubtitle(states.kind);
  const title = states.displayName ?? states.name;

  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-1.5", className)}>
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5">
          <ProjectSourceDockerIcon
            aria-hidden
            className="size-4 text-blue-400"
          />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span
            className="min-w-0 truncate font-normal text-sm text-zinc-50 leading-5"
            title={title}
          >
            {title}
          </span>
          <span
            className="min-w-0 truncate font-normal text-muted-foreground text-xs leading-4"
            title={subtitle}
          >
            {subtitle}
          </span>
        </span>
      </span>
      <ContainerNodeHeaderMenu />
    </div>
  );
}

export function ContainerNodeBodyContent({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("container-node-body-content pt-2.5", className)}>
      <ContainerNodeImageRow />
      <ContainerNodeActionBar />
    </div>
  );
}

export function ContainerNodeImageRow({ className }: { className?: string }) {
  const {
    state: {
      states: { image },
    },
  } = useContainerNode();
  const copyValue = image.trim();
  const copyable = copyValue.length > 0;
  const displayImage = copyable ? copyValue : "--";

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "container-node-image-row relative flex min-w-0 flex-col gap-1.5 rounded-lg bg-zinc-950/20 p-2.5 transition-colors",
        !copyable && "container-node-image-row-static",
        className
      )}
      copyAriaLabel="Copy image"
      copyable={copyable}
      copyValue={copyValue}
      data-slot="container-node-image-row"
      rowKey="image"
      title=""
    >
      {({ copied, copyable: rowCopyable, copyRow }) => (
        <>
          <div
            className={cn(
              "relative z-10 flex min-w-0 items-center justify-between gap-2",
              rowCopyable ? "pointer-events-none" : "pointer-events-auto"
            )}
          >
            <span className="min-w-0 truncate font-normal text-muted-foreground text-xs leading-4">
              Image
            </span>
          </div>
          <div
            className={cn(
              "relative z-10 flex h-6 min-w-0 items-center justify-between gap-2 py-1 text-left font-mono text-xs leading-4",
              rowCopyable
                ? "pointer-events-none text-zinc-50"
                : "text-muted-foreground"
            )}
            data-copied={copied ? "true" : undefined}
            data-slot="container-node-image-value"
          >
            {rowCopyable ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <CanvasNode.CopyableRowControl
                      className="pointer-events-auto relative z-20 min-w-0 cursor-pointer truncate"
                      onClick={() => {
                        copyRow().catch(() => undefined);
                      }}
                    >
                      {displayImage}
                    </CanvasNode.CopyableRowControl>
                  }
                />
                <TooltipContent>{copyValue}</TooltipContent>
              </Tooltip>
            ) : (
              <span className="min-w-0 truncate">{displayImage}</span>
            )}
            <CanvasNode.CopyableRowActions label="Image" />
          </div>
        </>
      )}
    </CanvasNode.CopyableRow>
  );
}

export function ContainerNodeActionBar({ className }: { className?: string }) {
  const {
    actions: { quickActions },
    state: {
      states: { status },
    },
  } = useContainerNode();
  const availability = containerNodeQuickActionAvailability(
    status?.tone ?? status?.label
  );

  return (
    <CanvasNode.ActionBar className={className}>
      {QUICK_ACTION_ITEMS.map((item) => {
        const entry = availability[item.key];
        const action =
          entry === undefined
            ? quickActions?.[item.key]
            : canvasNodeActionWithAvailability(quickActions?.[item.key], entry);
        const Icon = item.icon;

        return (
          <CanvasNode.ActionButton
            action={action}
            aria-label={item.label}
            key={item.key}
            title={item.tooltip}
          >
            <Icon aria-hidden className="size-4" />
          </CanvasNode.ActionButton>
        );
      })}
    </CanvasNode.ActionBar>
  );
}

export function ContainerNodeFooterContent({
  className,
  metricsContent,
}: {
  className?: string;
  metricsContent?: ReactNode;
}) {
  const {
    state: {
      states: { metrics, status },
    },
  } = useContainerNode();
  const visualStatus = resolveContainerNodeStatus(status);

  return (
    <div
      className={cn(
        "container-node-footer-content flex w-full min-w-0 items-center justify-between gap-2 text-xs leading-none",
        className
      )}
      data-slot="container-node-footer-content"
    >
      <CanvasNode.FooterStatus status={visualStatus} />
      <CanvasNode.Metrics>
        {metricsContent ?? <ContainerNodeMetricsContent metrics={metrics} />}
        <ContainerNodeReplicasMetric />
      </CanvasNode.Metrics>
    </div>
  );
}

export function ContainerNodeMetricsContent({
  metrics,
}: {
  metrics?: ContainerNodeStates["metrics"];
}) {
  return (
    <>
      {METRIC_ITEMS.map((item) => {
        const Icon = item.icon;

        return (
          <CanvasNode.Metric
            format="percent"
            key={item.key}
            label={item.label}
            value={metrics?.[item.key]}
          >
            <Icon aria-hidden className="size-3.5 shrink-0" />
          </CanvasNode.Metric>
        );
      })}
    </>
  );
}

function ContainerNodeReplicasMetric() {
  const {
    state: {
      states: { readyReplicas, replicas },
    },
  } = useContainerNode();

  return (
    <CanvasNode.Metric
      label="Replicas"
      value={formatContainerReplicas(replicas, readyReplicas)}
    >
      <Layers aria-hidden className="size-3.5 shrink-0" />
    </CanvasNode.Metric>
  );
}

function ContainerNodeHeaderMenu() {
  const {
    actions: { lifecycleActions },
    state: {
      states: { status },
    },
  } = useContainerNode();
  const availability = containerNodeLifecycleAvailability(
    status?.tone ?? status?.label
  );

  if (lifecycleActions == null) {
    return null;
  }

  return (
    <CanvasNode.ActionMenu aria-label="Open workload actions">
      {LIFECYCLE_ACTION_ITEMS.map((item) => {
        const entry = availability[item.key];
        if (!entry.present) {
          return null;
        }

        const action = canvasNodeActionWithAvailability(
          lifecycleActions?.[item.key],
          entry
        );
        const Icon = item.icon;

        return (
          <CanvasNode.ActionMenuItem
            action={action}
            actionKey={item.key}
            icon={<Icon aria-hidden className="size-4" />}
            key={item.key}
            tone={item.tone}
          >
            {item.label}
          </CanvasNode.ActionMenuItem>
        );
      })}
    </CanvasNode.ActionMenu>
  );
}
