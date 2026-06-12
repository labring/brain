"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import { CanvasNodeStatusDot } from "@workspace/ui/components/canvas-node/canvas-node.status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { EllipsisVertical, SquarePen, Trash2 } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";

import { useProjectExplorer } from "./project-explorer.context";
import type { ProjectExplorerProject } from "./project-explorer.types";
import { formatCreatedAt, toDate } from "./project-explorer.utils";

export function isProjectDeleteVerificationMatch(
  verification: string,
  displayName: string
): boolean {
  return displayName !== "" && verification.trim() === displayName;
}

export function ProjectExplorerListItem({
  className,
  project,
}: {
  className?: string;
  project: ProjectExplorerProject;
}) {
  const { actions } = useProjectExplorer();
  const interactive = actions.onProjectClick != null;
  const canRename = actions.onProjectRename != null;
  const canDelete = actions.onProjectDelete != null;
  const showRowMenu = canRename || canDelete;
  const projectId = project.id;
  const showProjectId = projectId !== "" && projectId !== project.name;

  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState(project.name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteVerification, setDeleteVerification] = useState("");

  useEffect(() => {
    if (renameOpen) {
      setRenameDraft(project.name);
      setRenameError(null);
    }
  }, [renameOpen, project.name]);
  useEffect(() => {
    if (deleteOpen) {
      setDeleteVerification("");
    }
  }, [deleteOpen]);

  const created = toDate(project.createdAt);
  const iso = Number.isNaN(created.getTime())
    ? undefined
    : created.toISOString();

  const handleRowActivate = useCallback(() => {
    actions.onProjectClick?.(project);
  }, [actions, project]);

  const handleRowKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleRowActivate();
      }
    },
    [handleRowActivate]
  );

  const submitRename = useCallback(async () => {
    const next = renameDraft.trim();
    if (next === "" || next === project.name) {
      setRenameOpen(false);
      return;
    }
    if (!actions.onProjectRename) {
      return;
    }
    setRenameBusy(true);
    setRenameError(null);
    try {
      await actions.onProjectRename(project, next);
      setRenameOpen(false);
    } catch (error) {
      setRenameError(
        error instanceof Error ? error.message : "Project rename failed."
      );
    } finally {
      setRenameBusy(false);
    }
  }, [actions, project, renameDraft]);

  const submitDelete = useCallback(async () => {
    const onProjectDelete = actions.onProjectDelete;
    if (!onProjectDelete) {
      return;
    }
    if (!isProjectDeleteVerificationMatch(deleteVerification, project.name)) {
      return;
    }
    setDeleteBusy(true);
    try {
      await onProjectDelete(project);
      setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  }, [actions, deleteVerification, project]);

  return (
    <li
      className={cn("rounded-xl", className)}
      data-slot="project-explorer-item"
    >
      <div
        className={cn(
          "project-explorer-item-row flex min-w-0 items-center gap-2 rounded-xl bg-transparent p-2.5 transition-colors",
          interactive && "cursor-pointer"
        )}
      >
        <CanvasNodeStatusDot
          size="small"
          status={{ label: "", visualTone: project.status }}
        />
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-row items-baseline justify-between gap-3 text-start",
            interactive && "cursor-pointer"
          )}
          {...(interactive
            ? {
                role: "button" as const,
                tabIndex: 0,
                onClick: handleRowActivate,
                onKeyDown: handleRowKeyDown,
              }
            : {})}
        >
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
        {showRowMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <AppIconButton
                  aria-label={`Actions for ${project.name}`}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
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
              side="right"
              sideOffset={14}
            >
              {canRename ? (
                <DropdownMenuItem
                  className="project-explorer-action-menu-item h-7 cursor-pointer rounded-md px-2 py-0 font-normal text-foreground text-sm leading-none hover:bg-input hover:text-foreground focus:bg-input focus:text-foreground"
                  onClick={() => setRenameOpen(true)}
                >
                  <SquarePen aria-hidden className="size-4" />
                  Rename
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <DropdownMenuItem
                  className="project-explorer-action-menu-item h-7 cursor-pointer rounded-md px-2 py-0 font-normal text-foreground text-sm leading-none hover:bg-input hover:text-foreground focus:bg-input focus:text-foreground"
                  data-tone="destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 aria-hidden className="size-4" />
                  Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <AppDialog.Root
        onOpenChange={(nextOpen) => {
          if (renameBusy && !nextOpen) {
            return;
          }
          setRenameOpen(nextOpen);
        }}
        open={renameOpen}
      >
        <AppDialog.Content
          data-slot="project-explorer-rename-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <AppDialog.Header>
            <AppDialog.Icon>
              <SquarePen aria-hidden />
            </AppDialog.Icon>
            <AppDialog.Title>Rename project</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              Update the project display name
            </AppDialog.Description>
            <AppInputField
              autoComplete="off"
              error={renameError}
              id={`project-rename-${project.id}`}
              label="Name"
              onChange={(e) => {
                setRenameDraft(e.target.value);
                if (renameError) {
                  setRenameError(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitRename().catch(() => undefined);
                }
              }}
              value={renameDraft}
            />
          </AppDialog.Body>
          <AppDialog.Footer>
            <AppDialog.Cancel
              className="bg-input/30 hover:bg-input"
              disabled={renameBusy}
            >
              Cancel
            </AppDialog.Cancel>
            <AppDialog.Action
              className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-hover"
              disabled={
                renameBusy ||
                renameDraft.trim() === "" ||
                renameDraft.trim() === project.name
              }
              loading={renameBusy}
              loadingLabel="Saving"
              onClick={() => submitRename().catch(() => undefined)}
              type="button"
            >
              Save
            </AppDialog.Action>
          </AppDialog.Footer>
        </AppDialog.Content>
      </AppDialog.Root>

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
          </AppDialog.Body>
          <AppDialog.Footer>
            <AppDialog.Cancel disabled={deleteBusy}>Cancel</AppDialog.Cancel>
            <AppDialog.DestructiveAction
              disabled={
                !isProjectDeleteVerificationMatch(
                  deleteVerification,
                  project.name
                )
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
