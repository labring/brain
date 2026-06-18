"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { PackageCheck, PanelRightOpen, X } from "lucide-react";
import type { DeploymentTaskTimelineReentry } from "./deployment-task-timeline-reentry";

export function ProjectCanvasDeploymentTaskTimelineReentryAffordance({
  className,
  onDismiss,
  onOpen,
  reentry,
}: {
  className?: string;
  onDismiss: (taskId: string) => void;
  onOpen: (taskId: string) => void;
  reentry: DeploymentTaskTimelineReentry | null;
}) {
  if (reentry == null) {
    return null;
  }

  return (
    <div
      className={cn(
        "pointer-events-auto flex min-w-0 items-center gap-2 rounded-md border bg-card px-2 py-1.5 shadow-md",
        className
      )}
      data-slot="deployment-task-timeline-reentry"
    >
      <PackageCheck aria-hidden className="size-4 shrink-0 text-blue-400" />
      <div className="min-w-0">
        <div className="truncate font-medium text-foreground text-sm">
          {reentry.label}
        </div>
        <div className="truncate text-muted-foreground text-xs">
          {reentry.task.id}
        </div>
      </div>
      <AppButton
        className="ml-1"
        onClick={() => onOpen(reentry.task.id)}
        size="sm"
        type="button"
        variant="secondary"
      >
        <PanelRightOpen
          aria-hidden
          className="size-3.5"
          data-icon="inline-start"
        />
        Open timeline
      </AppButton>
      <Tooltip>
        <TooltipTrigger
          render={
            <AppIconButton
              aria-label="Dismiss deployment timeline re-entry"
              onClick={() => onDismiss(reentry.task.id)}
              size="sm"
              type="button"
              variant="quiet"
            >
              <X aria-hidden className="size-3.5" />
            </AppIconButton>
          }
        />
        <TooltipContent>Dismiss</TooltipContent>
      </Tooltip>
    </div>
  );
}
