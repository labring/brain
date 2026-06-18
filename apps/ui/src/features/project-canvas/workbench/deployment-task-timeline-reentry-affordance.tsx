"use client";

import { ProjectSourceDockerIcon } from "@workspace/ui/assets/project-source-icons";
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
  MessageSquareText,
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
      return <ProjectSourceDockerIcon aria-hidden className="size-3.5" />;
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

function TaskStatusIndicator({ task }: { task: DeploymentTaskProjection }) {
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

function DeploymentTaskDockTask({
  item,
  onDismiss,
  onOpen,
}: {
  item: DeploymentTaskDockItem;
  onDismiss: (taskId: string) => void;
  onOpen: (taskId: string) => void;
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
        "h-10 w-max min-w-36 max-w-[12.5rem] border-white/15 bg-zinc-900/85 px-1.5 py-1 shadow-[0_1px_3px_rgba(0,0,0,0.22)] focus-within:border-white/20 focus-within:bg-zinc-900 hover:border-white/20 hover:bg-zinc-900 max-sm:w-full max-sm:max-w-full",
        item.active && "bg-input"
      )}
      data-active={item.active ? "true" : "false"}
      data-slot="deployment-task-dock-task"
    >
      <button
        aria-current={item.active ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-300/45",
          "h-full px-1.5"
        )}
        onClick={() => onOpen(task.id)}
        title={title}
        type="button"
      >
        <span
          aria-hidden
          className="flex size-4 shrink-0 items-center justify-center rounded-md text-white"
          title={sourceLabel}
        >
          <SourceKindIcon kind={display.sourceKind} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-[0.8125rem] text-white leading-4">
            {display.sourceSummary}
          </span>
        </span>
        <TaskStatusIndicator task={task} />
      </button>
      <TaskDismissButton
        className="size-5 text-zinc-400"
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
      aria-label={
        expanded
          ? "Show fewer deployment tasks"
          : `Show ${hiddenCount} more deployment tasks`
      }
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 font-medium text-xs text-zinc-200 outline-none transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-blue-300/45",
        className
      )}
      onClick={onToggle}
      type="button"
    >
      <span>{expanded ? "Show less" : `+${hiddenCount}`}</span>
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
  const desktopTasks = expanded ? dock.tasks : dock.desktopTasks;
  const mobileTasks = expanded ? dock.tasks : dock.mobileTasks;

  return (
    <div
      className={cn(
        "pointer-events-auto w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] rounded-lg border border-white/10 p-1 sm:w-fit",
        expanded && "bg-zinc-950/70 backdrop-blur-md",
        className
      )}
      data-slot="deployment-task-dock"
    >
      <div className="flex min-w-0 items-start gap-1.5 sm:hidden">
        <div
          className={cn("min-w-0 flex-1", expanded && "flex flex-col gap-1.5")}
        >
          {mobileTasks.map((item) => (
            <DeploymentTaskDockTask
              item={item}
              key={item.task.id}
              onDismiss={onDismiss}
              onOpen={onOpen}
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
        {desktopTasks.map((item) => (
          <DeploymentTaskDockTask
            item={item}
            key={item.task.id}
            onDismiss={onDismiss}
            onOpen={onOpen}
          />
        ))}
        <ExpandButton
          expanded={expanded}
          hiddenCount={dock.desktopHiddenCount}
          onToggle={toggleExpanded}
        />
      </div>
    </div>
  );
}

export const ProjectCanvasDeploymentTaskTimelineReentryAffordance =
  ProjectCanvasDeploymentTaskDock;
