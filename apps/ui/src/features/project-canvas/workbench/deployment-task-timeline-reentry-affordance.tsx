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
import { Fragment, useState } from "react";
import {
  type DeploymentTaskDisplaySummary,
  type DeploymentTaskProjection,
  deploymentTaskShortCode,
} from "@/features/deploy/task/projection";
import {
  deployTaskIsTerminal,
  deployTaskStatusDotClass,
  deployTaskStatusLabel,
} from "@/features/deploy/task/status-presentation";
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

const statusLabel = deployTaskStatusLabel;
const statusDotTone = deployTaskStatusDotClass;

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
              "size-6 text-muted-foreground hover:bg-white/10 hover:text-foreground",
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
        className={cn("size-2 rounded-full", statusDotTone(task.status))}
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
        "group/dock-task flex min-w-0 items-center gap-[6px] overflow-hidden rounded-md bg-white/[0.05] px-4 py-2 transition-colors hover:bg-white/[0.08]",
        "max-sm:w-full max-sm:max-w-full",
        item.active && "bg-white/10"
      )}
      data-active={item.active ? "true" : "false"}
      data-slot="deployment-task-dock-task"
    >
      <button
        aria-current={item.active ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-[6px] rounded-md text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-300/45"
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
            <span className="ml-1.5 font-mono font-normal text-[0.6875rem] text-white/45">
              #{deploymentTaskShortCode(task.id)}
            </span>
          </span>
        </span>
        <TaskStatusIndicator task={task} />
      </button>
      {deployTaskIsTerminal(task.status) ? (
        <TaskDismissButton
          className="size-6 text-muted-foreground"
          onDismiss={onDismiss}
          task={task}
        />
      ) : null}
    </div>
  );
}

function DeploymentTaskDockDivider() {
  return (
    <div
      aria-hidden
      className="flex h-9 w-px shrink-0 items-center justify-center"
      data-slot="deployment-task-dock-divider"
    >
      <div className="h-9 w-px rounded-full bg-white/10" />
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
        "inline-flex shrink-0 items-center gap-[6px] rounded-md bg-white/[0.08] px-4 py-2 font-medium text-foreground text-sm outline-none transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-blue-300/45",
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
        "pointer-events-auto w-[calc(100vw-13rem)] max-w-[calc(100vw-13rem)] overflow-hidden rounded-lg sm:w-fit",
        className
      )}
      data-slot="deployment-task-dock"
    >
      <div className="flex min-w-0 items-start sm:hidden">
        <div className={cn("min-w-0 flex-1", expanded && "flex flex-col")}>
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
      <div className="hidden min-w-0 flex-nowrap items-center gap-1 sm:flex">
        {desktopTasks.map((item, index) => (
          <Fragment key={item.task.id}>
            {index > 0 ? <DeploymentTaskDockDivider /> : null}
            <DeploymentTaskDockTask
              item={item}
              onDismiss={onDismiss}
              onOpen={onOpen}
            />
          </Fragment>
        ))}
        {dock.desktopHiddenCount > 0 && desktopTasks.length > 0 ? (
          <DeploymentTaskDockDivider />
        ) : null}
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
