"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppSelect } from "@workspace/ui/components/app-select";
import { CanvasNodeStatusDot } from "@workspace/ui/components/canvas-node/canvas-node.status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { EllipsisVertical, Pin, PinOff, SquarePen, Trash2 } from "lucide-react";
import { useCallback, useState } from "react";

import {
  ProjectEditDialog,
  type ProjectEditDialogValues,
} from "../project-edit-dialog";
import { useProjectExplorer } from "./project-explorer.context";
import type {
  ProjectDeleteReason,
  ProjectExplorerProject,
} from "./project-explorer.types";
import { formatCreatedAt, toDate } from "./project-explorer.utils";

const PROJECT_DESCRIPTION_EMPTY_ACCESSIBLE_LABEL = "No project description";
const PROJECT_DESCRIPTION_EMPTY_LABEL = "-";
const PROJECT_DELETE_REASON_OPTIONS: readonly {
  label: string;
  value: ProjectDeleteReason;
}[] = [
  { label: "Not working", value: "not_working" },
  { label: "Too slow", value: "too_slow" },
  { label: "Deployment failed", value: "failed" },
  { label: "Cleanup", value: "cleanup" },
];

function projectExplorerItemRowClassName(interactive: boolean) {
  return cn(
    "project-explorer-item-row relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-x-2 gap-y-1 rounded-xl bg-transparent px-[18px] pt-2.5 pb-[18px] transition-colors hover:bg-input/30 hover:backdrop-blur-[2px]",
    interactive && "cursor-pointer"
  );
}

export function isProjectDeleteVerificationMatch(
  verification: string,
  displayName: string
): boolean {
  return displayName !== "" && verification.trim() === displayName;
}

function projectPinActionLabel(projectName: string, pinned: boolean): string {
  return pinned ? `Unpin ${projectName}` : `Pin ${projectName}`;
}

function projectPinTooltip({
  limit,
  limitReached,
  pinned,
}: {
  limit: number;
  limitReached: boolean;
  pinned: boolean;
}): string {
  if (limitReached) {
    return `You can pin up to ${limit} projects.`;
  }
  return pinned ? "Unpin project" : "Pin project";
}

function ProjectExplorerPinAction({
  limit,
  limitReached,
  onToggle,
  pinned,
  projectName,
}: {
  limit: number;
  limitReached: boolean;
  onToggle: () => void;
  pinned: boolean;
  projectName: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <AppIconButton
            aria-label={projectPinActionLabel(projectName, pinned)}
            aria-pressed={pinned}
            className="text-muted-foreground hover:text-foreground"
            disabled={limitReached}
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            onPointerDown={(event) => event.stopPropagation()}
            size="lg"
            type="button"
            variant="quiet"
          >
            {pinned ? (
              <PinOff aria-hidden className="size-4" />
            ) : (
              <Pin aria-hidden className="size-4" />
            )}
          </AppIconButton>
        }
      />
      <TooltipContent side="right">
        {projectPinTooltip({ limit, limitReached, pinned })}
      </TooltipContent>
    </Tooltip>
  );
}

function ProjectExplorerRowMenu({
  canDelete,
  canEdit,
  onDelete,
  onEdit,
  projectName,
}: {
  canDelete: boolean;
  canEdit: boolean;
  onDelete: () => void;
  onEdit: () => void;
  projectName: string;
}) {
  if (!(canEdit || canDelete)) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <AppIconButton
            aria-label={`Actions for ${projectName}`}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            size="lg"
            type="button"
            variant="quiet"
          >
            <EllipsisVertical aria-hidden className="size-4" />
          </AppIconButton>
        }
      />
      <DropdownMenuContent
        align="start"
        className="w-38 min-w-38 rounded-md border border-border bg-input/30 p-1 text-foreground shadow-none ring-0! backdrop-blur-xl"
        onClick={(event) => event.stopPropagation()}
        side="right"
        sideOffset={14}
      >
        {canEdit ? (
          <DropdownMenuItem
            className="project-explorer-action-menu-item h-7 cursor-pointer rounded-md px-2 py-0 font-normal text-foreground text-sm leading-none hover:bg-input hover:text-foreground focus:bg-input focus:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <SquarePen aria-hidden className="size-4" />
            Edit
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <DropdownMenuItem
            className="project-explorer-action-menu-item h-7 cursor-pointer rounded-md px-2 py-0 font-normal text-foreground text-sm leading-none hover:bg-input hover:text-foreground focus:bg-input focus:text-foreground"
            data-tone="destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 aria-hidden className="size-4" />
            Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProjectExplorerRowActions({
  canDelete,
  canEdit,
  canTogglePin,
  limit,
  limitReached,
  onDelete,
  onEdit,
  onTogglePin,
  pinned,
  projectName,
}: {
  canDelete: boolean;
  canEdit: boolean;
  canTogglePin: boolean;
  limit: number;
  limitReached: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
  pinned: boolean;
  projectName: string;
}) {
  if (!(canTogglePin || canEdit || canDelete)) {
    return null;
  }

  return (
    <div className="relative z-10 flex shrink-0 items-center gap-0.5">
      {canTogglePin ? (
        <ProjectExplorerPinAction
          limit={limit}
          limitReached={limitReached}
          onToggle={onTogglePin}
          pinned={pinned}
          projectName={projectName}
        />
      ) : null}
      <ProjectExplorerRowMenu
        canDelete={canDelete}
        canEdit={canEdit}
        onDelete={onDelete}
        onEdit={onEdit}
        projectName={projectName}
      />
    </div>
  );
}

export function ProjectExplorerListItem({
  className,
  project,
}: {
  className?: string;
  project: ProjectExplorerProject;
}) {
  const { actions, states } = useProjectExplorer();
  const interactive = actions.onProjectClick != null;
  const canEdit = actions.onProjectUpdate != null;
  const canDelete = actions.onProjectDelete != null;
  const canTogglePin = actions.onProjectPinToggle != null;
  const pinnedProjectIds = states.pinnedProjectIds ?? [];
  const pinnedProjectLimit =
    states.pinnedProjectLimit ?? Number.POSITIVE_INFINITY;
  const pinned = pinnedProjectIds.includes(project.id);
  const pinLimitReached =
    !pinned && pinnedProjectIds.length >= pinnedProjectLimit;
  const projectId = project.id;
  const showProjectId = projectId !== "" && projectId !== project.name;
  const description = project.description?.trim() ?? "";

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteReason, setDeleteReason] = useState<ProjectDeleteReason | "">(
    ""
  );
  const [deleteVerification, setDeleteVerification] = useState("");

  const [prevDeleteOpen, setPrevDeleteOpen] = useState(deleteOpen);
  if (deleteOpen !== prevDeleteOpen) {
    setPrevDeleteOpen(deleteOpen);
    if (deleteOpen) {
      setDeleteReason("");
      setDeleteVerification("");
    }
  }

  const created = toDate(project.createdAt);
  const iso = Number.isNaN(created.getTime())
    ? undefined
    : created.toISOString();

  const handleRowActivate = useCallback(() => {
    actions.onProjectClick?.(project);
  }, [actions, project]);

  const submitEdit = useCallback(
    async (next: ProjectEditDialogValues) => {
      if (!actions.onProjectUpdate) {
        return;
      }
      await actions.onProjectUpdate(project, {
        description: next.description,
        displayName: next.displayName,
      });
    },
    [actions, project]
  );

  const submitDelete = useCallback(async () => {
    const onProjectDelete = actions.onProjectDelete;
    if (!onProjectDelete) {
      return;
    }
    if (
      !isProjectDeleteVerificationMatch(deleteVerification, project.name) ||
      deleteReason === ""
    ) {
      return;
    }
    setDeleteBusy(true);
    try {
      await onProjectDelete(project, deleteReason);
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  }, [actions, deleteReason, deleteVerification, project]);

  const togglePin = useCallback(() => {
    if (!actions.onProjectPinToggle || pinLimitReached) {
      return;
    }
    actions.onProjectPinToggle(project);
  }, [actions, pinLimitReached, project]);

  const hasDescription = description !== "";
  const rowClassName = projectExplorerItemRowClassName(interactive);

  return (
    <li
      className={cn("rounded-xl", className)}
      data-slot="project-explorer-item"
    >
      <div className={rowClassName}>
        {interactive ? (
          <button
            aria-label={`Open ${project.name}`}
            className="absolute inset-0 z-0 cursor-pointer rounded-xl text-start"
            onClick={handleRowActivate}
            type="button"
          />
        ) : null}
        <CanvasNodeStatusDot
          className="pointer-events-none relative z-10 self-center"
          size="small"
          status={{ label: "", visualTone: project.status }}
        />
        <div className="pointer-events-none relative z-10 col-start-2 row-start-1 min-w-0 self-center text-start">
          <div className="flex min-w-0 items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-medium text-foreground text-sm">
              {project.name}
            </span>
            <time
              className="shrink-0 text-muted-foreground text-xs tabular-nums"
              dateTime={iso}
            >
              {formatCreatedAt(project.createdAt)}
            </time>
          </div>
        </div>
        <ProjectExplorerRowActions
          canDelete={canDelete}
          canEdit={canEdit}
          canTogglePin={canTogglePin}
          limit={pinnedProjectLimit}
          limitReached={pinLimitReached}
          onDelete={() => setDeleteOpen(true)}
          onEdit={() => setEditOpen(true)}
          onTogglePin={togglePin}
          pinned={pinned}
          projectName={project.name}
        />
        <p
          className={cn(
            "pointer-events-none relative z-10 col-span-full row-start-2 min-w-0 truncate text-sm leading-5",
            hasDescription
              ? "text-muted-foreground"
              : "text-muted-foreground/45"
          )}
        >
          {hasDescription ? (
            description
          ) : (
            <>
              <span aria-hidden>{PROJECT_DESCRIPTION_EMPTY_LABEL}</span>
              <span className="sr-only">
                {PROJECT_DESCRIPTION_EMPTY_ACCESSIBLE_LABEL}
              </span>
            </>
          )}
        </p>
      </div>

      <ProjectEditDialog
        currentDescription={description}
        currentName={project.name}
        dataSlot="project-explorer-edit-dialog"
        idBase={`project-edit-${project.id}`}
        onOpenChange={setEditOpen}
        onSubmit={submitEdit}
        open={editOpen}
      />

      <AppDialog.Root
        onOpenChange={(nextOpen) => {
          if (deleteBusy && !nextOpen) {
            return;
          }
          setDeleteOpen(nextOpen);
        }}
        open={deleteOpen}
      >
        <AppDialog.Content
          data-slot="project-explorer-delete-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <AppDialog.Header>
            <AppDialog.WarningIcon />
            <AppDialog.Title>Delete project?</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              This will delete{" "}
              <span className="font-medium text-foreground">
                {project.name}
              </span>{" "}
              from the cluster.{" "}
              {showProjectId ? (
                <>
                  Project ID: <span className="font-mono">{projectId}</span>.{" "}
                </>
              ) : null}
              This cannot be undone.
            </AppDialog.Description>
            <AppDialog.Field>
              <p className="select-text text-sm/5 text-zinc-400">
                Type{" "}
                <span className="font-medium text-zinc-100">
                  {project.name}
                </span>{" "}
                to confirm.
              </p>
              <AppDialog.Input
                aria-label={`Type ${project.name} to confirm.`}
                autoComplete="off"
                onChange={(event) => setDeleteVerification(event.target.value)}
                placeholder={project.name}
                type="text"
                value={deleteVerification}
              />
            </AppDialog.Field>
            <AppDialog.Field>
              <label
                className="text-sm/5 text-zinc-300"
                htmlFor={`project-delete-reason-${project.id}`}
              >
                Why are you deleting this project?
              </label>
              <AppSelect
                aria-label="Deletion reason"
                id={`project-delete-reason-${project.id}`}
                onValueChange={(value) =>
                  setDeleteReason(value as ProjectDeleteReason)
                }
                options={PROJECT_DELETE_REASON_OPTIONS}
                placeholder="Select a reason"
                value={deleteReason}
              />
            </AppDialog.Field>
          </AppDialog.Body>
          <AppDialog.Footer>
            <AppDialog.Cancel disabled={deleteBusy}>Cancel</AppDialog.Cancel>
            <AppDialog.DestructiveAction
              disabled={
                !isProjectDeleteVerificationMatch(
                  deleteVerification,
                  project.name
                ) || deleteReason === ""
              }
              loading={deleteBusy}
              loadingLabel="Deleting"
              onClick={(e) => {
                e.stopPropagation();
                submitDelete().catch(() => undefined);
              }}
              type="button"
            >
              Delete
            </AppDialog.DestructiveAction>
          </AppDialog.Footer>
        </AppDialog.Content>
      </AppDialog.Root>
    </li>
  );
}
