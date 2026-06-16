"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import { AppTextarea } from "@workspace/ui/components/app-textarea";
import { CanvasNodeStatusDot } from "@workspace/ui/components/canvas-node/canvas-node.status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@workspace/ui/components/field";
import { cn } from "@workspace/ui/lib/utils";
import { EllipsisVertical, SquarePen, Trash2 } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";

import { useProjectExplorer } from "./project-explorer.context";
import type { ProjectExplorerProject } from "./project-explorer.types";
import { formatCreatedAt, toDate } from "./project-explorer.utils";

const PROJECT_DESCRIPTION_MAX_LENGTH = 256;

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
  const canEdit = actions.onProjectUpdate != null;
  const canDelete = actions.onProjectDelete != null;
  const showRowMenu = canEdit || canDelete;
  const projectId = project.id;
  const showProjectId = projectId !== "" && projectId !== project.name;
  const description = project.description?.trim() ?? "";

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(project.name);
  const [descriptionDraft, setDescriptionDraft] = useState(description);
  const [editError, setEditError] = useState<string | null>(null);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteVerification, setDeleteVerification] = useState("");

  useEffect(() => {
    if (editOpen) {
      setDisplayNameDraft(project.name);
      setDescriptionDraft(description);
      setEditError(null);
      setDescriptionError(null);
    }
  }, [description, editOpen, project.name]);
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

  const submitEdit = useCallback(async () => {
    const displayName = displayNameDraft.trim();
    const nextDescription = descriptionDraft.trim();
    if (displayName === "") {
      setEditError("Project name is required.");
      return;
    }
    if (nextDescription.length > PROJECT_DESCRIPTION_MAX_LENGTH) {
      setDescriptionError(
        "Project description must be 256 characters or fewer."
      );
      return;
    }
    if (displayName === project.name && nextDescription === description) {
      setEditOpen(false);
      return;
    }
    if (!actions.onProjectUpdate) {
      return;
    }
    setEditBusy(true);
    setEditError(null);
    setDescriptionError(null);
    try {
      await actions.onProjectUpdate(project, {
        description: nextDescription,
        displayName,
      });
      setEditOpen(false);
    } catch (error) {
      setEditError(
        error instanceof Error ? error.message : "Project update failed."
      );
    } finally {
      setEditBusy(false);
    }
  }, [actions, description, descriptionDraft, displayNameDraft, project]);

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
          "project-explorer-item-row flex min-w-0 items-start gap-2 rounded-xl bg-transparent px-2.5 py-2.5 transition-colors",
          interactive && "cursor-pointer"
        )}
      >
        <CanvasNodeStatusDot
          className="mt-[3px]"
          size="small"
          status={{ label: "", visualTone: project.status }}
        />
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-1 text-start",
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
          {description === "" ? null : (
            <p className="min-w-0 truncate text-muted-foreground text-sm leading-5">
              {description}
            </p>
          )}
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
              {canEdit ? (
                <DropdownMenuItem
                  className="project-explorer-action-menu-item h-7 cursor-pointer rounded-md px-2 py-0 font-normal text-foreground text-sm leading-none hover:bg-input hover:text-foreground focus:bg-input focus:text-foreground"
                  onClick={() => setEditOpen(true)}
                >
                  <SquarePen aria-hidden className="size-4" />
                  Edit
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
          if (editBusy && !nextOpen) {
            return;
          }
          setEditOpen(nextOpen);
        }}
        open={editOpen}
      >
        <AppDialog.Content
          data-slot="project-explorer-edit-dialog"
          onClick={(e) => e.stopPropagation()}
        >
          <AppDialog.Header>
            <AppDialog.Icon>
              <SquarePen aria-hidden />
            </AppDialog.Icon>
            <AppDialog.Title>Edit project</AppDialog.Title>
          </AppDialog.Header>
          <AppDialog.Body>
            <AppDialog.Description>
              Update project details
            </AppDialog.Description>
            <AppInputField
              autoComplete="off"
              error={editError}
              id={`project-edit-name-${project.id}`}
              label="Name"
              onChange={(e) => {
                setDisplayNameDraft(e.target.value);
                if (editError) {
                  setEditError(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitEdit().catch(() => undefined);
                }
              }}
              value={displayNameDraft}
            />
            <Field
              className="gap-2"
              data-slot="project-explorer-description-field"
            >
              <div className="flex items-center justify-between gap-2">
                <FieldLabel
                  className="text-foreground leading-5"
                  htmlFor={`project-edit-description-${project.id}`}
                >
                  Description
                </FieldLabel>
                <span className="text-[11px] text-muted-foreground leading-4">
                  {`${descriptionDraft.length}/${PROJECT_DESCRIPTION_MAX_LENGTH}`}
                </span>
              </div>
              <AppTextarea
                aria-invalid={descriptionError === null ? undefined : true}
                className="min-h-9 resize-none border-input bg-transparent text-foreground placeholder:text-muted-foreground focus-visible:border-blue-500 focus-visible:ring-[1px] focus-visible:ring-blue-500/50 dark:bg-transparent"
                id={`project-edit-description-${project.id}`}
                maxLength={PROJECT_DESCRIPTION_MAX_LENGTH + 1}
                onChange={(event) => {
                  setDescriptionDraft(event.currentTarget.value);
                  if (descriptionError) {
                    setDescriptionError(null);
                  }
                }}
                placeholder="Optional project context"
                rows={1}
                value={descriptionDraft}
              />
              {descriptionError === null ? null : (
                <FieldError className="text-xs leading-4" role="alert">
                  {descriptionError}
                </FieldError>
              )}
            </Field>
          </AppDialog.Body>
          <AppDialog.Footer>
            <AppDialog.Cancel
              className="bg-input/30 hover:bg-input"
              disabled={editBusy}
            >
              Cancel
            </AppDialog.Cancel>
            <AppDialog.Action
              className="bg-brand-primary text-brand-primary-foreground hover:bg-brand-primary-hover"
              disabled={
                editBusy ||
                displayNameDraft.trim() === "" ||
                descriptionDraft.trim().length >
                  PROJECT_DESCRIPTION_MAX_LENGTH ||
                (displayNameDraft.trim() === project.name &&
                  descriptionDraft.trim() === description)
              }
              loading={editBusy}
              loadingLabel="Saving"
              onClick={() => submitEdit().catch(() => undefined)}
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
