"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  Blocks,
  ChevronDown,
  Code2,
  Database,
  ImageIcon,
  MessageSquareText,
  PackageCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import type {
  DeploymentTaskDisplaySummary,
  DeploymentTaskProjection,
} from "@/lib/deploy-task/projection";
import type {
  DeploymentTaskDockItem,
  DeploymentTaskDockModel,
} from "./deployment-task-timeline-reentry";

function taskDisplay(
  task: DeploymentTaskProjection
): DeploymentTaskDisplaySummary {
  return (
    task.display ?? {
      resultSummary: task.id,
      sourceKind: "prompt",
      sourceSummary: "Deployment task",
    }
  );
}

function sourceKindLabel(kind: DeploymentTaskDisplaySummary["sourceKind"]) {
  switch (kind) {
    case "database":
      return "Database";
    case "docker":
      return "Docker";
    case "github":
      return "GitHub";
    case "prompt":
      return "Prompt";
    case "template":
      return "Template";
    default:
      return kind satisfies never;
  }
}

function SourceKindIcon({
  kind,
}: {
  kind: DeploymentTaskDisplaySummary["sourceKind"];
}) {
  switch (kind) {
    case "database":
      return <Database aria-hidden className="size-3.5" />;
    case "docker":
      return <ImageIcon aria-hidden className="size-3.5" />;
    case "github":
      return <Code2 aria-hidden className="size-3.5" />;
    case "prompt":
      return <MessageSquareText aria-hidden className="size-3.5" />;
    case "template":
      return <Blocks aria-hidden className="size-3.5" />;
    default:
      return kind satisfies never;
  }
}

function statusLabel(status: DeploymentTaskProjection["status"]): string {
  switch (status) {
    case "applying":
      return "applying";
    case "blocked":
      return "blocked";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "queued":
      return "queued";
    case "running":
      return "running";
    default:
      return status satisfies never;
  }
}

function statusDotTone(status: DeploymentTaskProjection["status"]): string {
  switch (status) {
    case "blocked":
      return "bg-amber-300";
    case "failed":
      return "bg-red-300";
    case "completed":
      return "bg-emerald-300";
    case "applying":
    case "running":
      return "bg-blue-300";
    case "queued":
      return "bg-zinc-300";
    case "cancelled":
      return "bg-zinc-500";
    default:
      return status satisfies never;
  }
}

function statusTextTone(status: DeploymentTaskProjection["status"]): string {
  switch (status) {
    case "blocked":
      return "text-amber-200/85";
    case "failed":
      return "text-red-200/85";
    case "completed":
      return "text-emerald-200/85";
    case "applying":
    case "running":
      return "text-blue-200/85";
    case "queued":
      return "text-zinc-300";
    case "cancelled":
      return "text-zinc-400";
    default:
      return status satisfies never;
  }
}

function TaskDismissButton({
  className,
  onDismiss,
  task,
}: {
  className?: string;
  onDismiss: (taskId: string) => void;
  task: DeploymentTaskProjection;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AppIconButton
            aria-label="Dismiss deployment task reminder"
            className={cn(
              "size-6 text-zinc-300 hover:bg-white/10 hover:text-white",
              className
            )}
            onClick={(event) => {
              event.stopPropagation();
              onDismiss(task.id);
            }}
            size="sm"
            type="button"
            variant="quiet"
          >
            <X aria-hidden className="size-3.5" />
          </AppIconButton>
        }
      />
      <TooltipContent>Dismiss reminder</TooltipContent>
    </Tooltip>
  );
}

function TaskStatusIndicator({
  task,
  variant,
}: {
  task: DeploymentTaskProjection;
  variant: "capsule" | "row";
}) {
  if (variant === "capsule") {
    return (
      <span
        className="inline-flex size-5 shrink-0 items-center justify-center"
        title={`${statusLabel(task.status)} · ${task.phase}`}
      >
        <span
          aria-hidden
          className={cn("size-1.5 rounded-full", statusDotTone(task.status))}
        />
        <span className="sr-only">{statusLabel(task.status)}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1 font-medium text-[0.6875rem]",
        statusTextTone(task.status)
      )}
      title={`${statusLabel(task.status)} · ${task.phase}`}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", statusDotTone(task.status))}
      />
      <span className="whitespace-nowrap">
        {variant === "capsule"
          ? statusLabel(task.status)
          : `${statusLabel(task.status)} · ${task.phase}`}
      </span>
    </span>
  );
}

function DeploymentTaskDockTask({
  item,
  onDismiss,
  onOpen,
  variant,
}: {
  item: DeploymentTaskDockItem;
  onDismiss: (taskId: string) => void;
  onOpen: (taskId: string) => void;
  variant: "capsule" | "row";
}) {
  const { task } = item;
  const display = taskDisplay(task);
  const sourceLabel = sourceKindLabel(display.sourceKind);
  const title = `${display.sourceSummary} · ${display.resultSummary} · ${statusLabel(
    task.status
  )} · ${task.phase}`;
  return (
    <div
      className={cn(
        "group/dock-task flex min-w-0 items-center gap-1 rounded-lg border transition-colors",
        variant === "capsule"
          ? "h-10 w-max min-w-36 max-w-[12.5rem] border-white/15 bg-zinc-900/85 px-1.5 py-1 shadow-[0_1px_3px_rgba(0,0,0,0.22)] focus-within:border-white/20 focus-within:bg-zinc-900 hover:border-white/20 hover:bg-zinc-900 max-sm:w-full max-sm:max-w-full"
          : "w-full border-white/10 bg-white/[0.04] px-1.5 py-1 focus-within:bg-white/[0.07] hover:bg-white/[0.07]",
        item.active && "border-blue-300/35 bg-blue-400/10"
      )}
      data-active={item.active ? "true" : "false"}
      data-slot="deployment-task-dock-task"
    >
      <button
        aria-current={item.active ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-300/45",
          variant === "capsule" ? "h-full px-1.5" : "px-1.5 py-1"
        )}
        onClick={() => onOpen(task.id)}
        title={title}
        type="button"
      >
        <span
          aria-hidden
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md text-blue-200",
            variant === "capsule" ? "size-4 opacity-85" : "size-5 bg-white/5"
          )}
          title={sourceLabel}
        >
          <SourceKindIcon kind={display.sourceKind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-[0.8125rem] text-white leading-4">
            {display.sourceSummary}
          </span>
          {variant === "row" ? (
            <span className="block truncate text-[0.6875rem] text-zinc-300 leading-4">
              {display.resultSummary}
            </span>
          ) : null}
        </span>
        <TaskStatusIndicator task={task} variant={variant} />
      </button>
      <TaskDismissButton
        className={variant === "capsule" ? "size-5 text-zinc-400" : undefined}
        onDismiss={onDismiss}
        task={task}
      />
    </div>
  );
}

function ExpandButton({
  className,
  expanded,
  hiddenCount,
  onToggle,
}: {
  className?: string;
  expanded: boolean;
  hiddenCount: number;
  onToggle: () => void;
}) {
  if (hiddenCount <= 0) {
    return null;
  }

  return (
    <button
      aria-expanded={expanded}
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 font-medium text-xs text-zinc-200 outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-blue-300/45",
        className
      )}
      onClick={onToggle}
      type="button"
    >
      <span>+{hiddenCount}</span>
      <ChevronDown
        aria-hidden
        className={cn(
          "size-3.5 transition-transform",
          expanded && "rotate-180"
        )}
      />
    </button>
  );
}

export function ProjectCanvasDeploymentTaskDock({
  className,
  dock,
  onDismiss,
  onOpen,
}: {
  className?: string;
  dock: DeploymentTaskDockModel;
  onDismiss: (taskId: string) => void;
  onOpen: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (dock.tasks.length === 0) {
    return null;
  }

  const toggleExpanded = () => setExpanded((current) => !current);

  return (
    <div
      className={cn(
        "pointer-events-auto w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] rounded-lg border border-white/10 p-1 sm:w-fit",
        expanded && "bg-zinc-950/70 backdrop-blur-md",
        className
      )}
      data-slot="deployment-task-dock"
    >
      <div className="flex min-w-0 items-center gap-1.5 sm:hidden">
        <div className="min-w-0 flex-1">
          {dock.mobileTasks.map((item) => (
            <DeploymentTaskDockTask
              item={item}
              key={item.task.id}
              onDismiss={onDismiss}
              onOpen={onOpen}
              variant="capsule"
            />
          ))}
        </div>
        <ExpandButton
          expanded={expanded}
          hiddenCount={dock.mobileHiddenCount}
          onToggle={toggleExpanded}
        />
      </div>
      <div className="hidden min-w-0 flex-wrap items-center gap-1.5 sm:flex">
        {dock.desktopTasks.map((item) => (
          <DeploymentTaskDockTask
            item={item}
            key={item.task.id}
            onDismiss={onDismiss}
            onOpen={onOpen}
            variant="capsule"
          />
        ))}
        <ExpandButton
          expanded={expanded}
          hiddenCount={dock.desktopHiddenCount}
          onToggle={toggleExpanded}
        />
      </div>
      {expanded ? (
        <div
          className="mt-1 flex max-h-[min(22rem,calc(100vh-8rem))] flex-col gap-1 overflow-y-auto border-white/10 border-t pt-1"
          data-slot="deployment-task-dock-list"
        >
          <div className="flex items-center gap-2 px-2 py-1 text-xs text-zinc-300">
            <PackageCheck aria-hidden className="size-3.5 text-blue-200" />
            <span>Deployment tasks</span>
          </div>
          {dock.tasks.map((item) => (
            <DeploymentTaskDockTask
              item={item}
              key={item.task.id}
              onDismiss={onDismiss}
              onOpen={onOpen}
              variant="row"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const ProjectCanvasDeploymentTaskTimelineReentryAffordance =
  ProjectCanvasDeploymentTaskDock;
