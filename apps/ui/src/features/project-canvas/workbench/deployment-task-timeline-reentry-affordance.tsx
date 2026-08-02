"use client";

import { ProjectSourceDockerIcon } from "@workspace/ui/assets/project-source-icons";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
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
import { Fragment, useLayoutEffect, useRef, useState } from "react";
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
import {
  type DeploymentTaskDockItem,
  type DeploymentTaskDockModel,
  fitDeploymentTaskDockChipCount,
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

/**
 * The overflow panel's body: the full visible task list with the same chip
 * semantics as the inline row (open on click, dismiss only when terminal).
 * Kept free of popover context so tests can render it directly.
 */
export function DeploymentTaskDockOverflowList({
  onDismiss,
  onOpen,
  tasks,
}: {
  onDismiss: (taskId: string) => void;
  onOpen: (taskId: string) => void;
  tasks: DeploymentTaskDockItem[];
}) {
  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      data-slot="deployment-task-dock-list"
    >
      <p className="px-2 pt-1 font-medium text-muted-foreground text-xs">
        Deployment tasks
      </p>
      <div className="flex max-h-[60vh] min-h-0 flex-col gap-1 overflow-y-auto">
        {tasks.map((item) => (
          <DeploymentTaskDockTask
            item={item}
            key={item.task.id}
            onDismiss={onDismiss}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The dock's overflow affordance: a "+N" trigger that opens a popover panel
 * listing every visible task. The panel grows downward as an overlay, so the
 * top bar row keeps its fixed height no matter how many tasks are queued.
 */
function DeploymentTaskDockOverflow({
  hiddenCount,
  onDismiss,
  onOpen,
  tasks,
}: {
  hiddenCount: number;
  onDismiss: (taskId: string) => void;
  onOpen: (taskId: string) => void;
  tasks: DeploymentTaskDockItem[];
}) {
  const [open, setOpen] = useState(false);

  if (hiddenCount <= 0) {
    return null;
  }

  const openTask = (taskId: string) => {
    setOpen(false);
    onOpen(taskId);
  };

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <button
            aria-label={`Show ${hiddenCount} more deployment tasks`}
            className="inline-flex shrink-0 items-center gap-[6px] rounded-md bg-white/[0.08] px-4 py-2 font-medium text-foreground text-sm outline-none transition-colors hover:bg-white/[0.12] focus-visible:ring-2 focus-visible:ring-blue-300/45"
            type="button"
          >
            <span>+{hiddenCount}</span>
            <ChevronDown
              aria-hidden
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-180"
              )}
            />
          </button>
        }
      />
      <PopoverContent
        align="start"
        aria-label="Deployment tasks"
        className="w-80 p-2"
        sideOffset={8}
      >
        <DeploymentTaskDockOverflowList
          onDismiss={onDismiss}
          onOpen={openTask}
          tasks={tasks}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The dock row at a decided visible count: the first `visibleCount` chips
 * inline, each elastic between the chip floor and `max-w-64`, the rest
 * behind the "+N" popover. Kept free of measurement so tests can render it
 * with an explicit count.
 */
export function DeploymentTaskDockRow({
  items,
  onDismiss,
  onOpen,
  visibleCount,
}: {
  items: DeploymentTaskDockItem[];
  onDismiss: (taskId: string) => void;
  onOpen: (taskId: string) => void;
  visibleCount: number;
}) {
  const visible = items.slice(0, visibleCount);
  const hiddenCount = items.length - visible.length;

  return (
    <div
      className="flex min-w-0 items-center gap-1"
      data-slot="deployment-task-dock-row"
    >
      {visible.map((item, index) => (
        <Fragment key={item.task.id}>
          {index > 0 ? <DeploymentTaskDockDivider /> : null}
          {/* min-w-32 must stay in sync with DEPLOYMENT_TASK_DOCK_CHIP_MIN_PX. */}
          <div className="flex min-w-32 max-w-64 *:w-full">
            <DeploymentTaskDockTask
              item={item}
              onDismiss={onDismiss}
              onOpen={onOpen}
            />
          </div>
        </Fragment>
      ))}
      {hiddenCount > 0 && visible.length > 0 ? (
        <DeploymentTaskDockDivider />
      ) : null}
      <DeploymentTaskDockOverflow
        hiddenCount={hiddenCount}
        onDismiss={onDismiss}
        onOpen={onOpen}
        tasks={items}
      />
    </div>
  );
}

/**
 * Measuring shell: observes the slot's width and lets the pure fit
 * arithmetic decide how many chips the row shows. Nothing renders until the
 * first measurement lands (pre-paint, via layout effect), so the bar never
 * flashes an unfitted row.
 */
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
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [slotWidth, setSlotWidth] = useState<number | null>(null);
  const hasTasks = dock.tasks.length > 0;

  useLayoutEffect(() => {
    if (!hasTasks) {
      return;
    }
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const measure = () => setSlotWidth(host.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [hasTasks]);

  if (!hasTasks) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-auto flex min-w-0 flex-1 items-center overflow-hidden",
        className
      )}
      data-slot="deployment-task-dock"
      ref={hostRef}
    >
      {slotWidth == null ? null : (
        <DeploymentTaskDockRow
          items={dock.tasks}
          onDismiss={onDismiss}
          onOpen={onOpen}
          visibleCount={fitDeploymentTaskDockChipCount(
            slotWidth,
            dock.tasks.length
          )}
        />
      )}
    </div>
  );
}

export const ProjectCanvasDeploymentTaskTimelineReentryAffordance =
  ProjectCanvasDeploymentTaskDock;
