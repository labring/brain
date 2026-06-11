"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import type { ReactNode } from "react";

export interface ProjectCanvasApDeleteTarget {
  displayName: string;
  kind?: string;
  name: string;
  namespace: string;
}

export interface ProjectCanvasDbDeleteTarget {
  displayName: string;
  name: string;
  namespace: string;
}

export interface ProjectCanvasDeleteDialogsProps {
  apTarget: ProjectCanvasApDeleteTarget | null;
  dbTarget: ProjectCanvasDbDeleteTarget | null;
  onApConfirm: () => void;
  onApOpenChange: (open: boolean) => void;
  onDbConfirm: () => void;
  onDbOpenChange: (open: boolean) => void;
}

export function ProjectCanvasDeleteDialogs({
  apTarget,
  dbTarget,
  onApConfirm,
  onApOpenChange,
  onDbConfirm,
  onDbOpenChange,
}: ProjectCanvasDeleteDialogsProps) {
  return (
    <>
      <ProjectCanvasApDeleteDialog
        onConfirm={onApConfirm}
        onOpenChange={onApOpenChange}
        target={apTarget}
      />
      <ProjectCanvasDbDeleteDialog
        onConfirm={onDbConfirm}
        onOpenChange={onDbOpenChange}
        target={dbTarget}
      />
    </>
  );
}

interface ProjectCanvasDeleteDialogProps {
  children: ReactNode;
  dataSlot: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: string;
}

function ProjectCanvasDeleteDialog({
  children,
  dataSlot,
  onConfirm,
  onOpenChange,
  open,
  title,
}: ProjectCanvasDeleteDialogProps) {
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open={open}>
      <AppDialog.Content data-slot={dataSlot}>
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>{title}</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>{children}</AppDialog.Description>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel>Cancel</AppDialog.Cancel>
          <AppDialog.DestructiveAction onClick={onConfirm} type="button">
            Delete
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

function ProjectCanvasApDeleteDialog({
  onConfirm,
  onOpenChange,
  target,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  target: ProjectCanvasApDeleteTarget | null;
}) {
  if (target == null) {
    return null;
  }
  const resolvedKind = target.kind?.trim();

  return (
    <ProjectCanvasDeleteDialog
      dataSlot="project-canvas-ap-delete-dialog"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open
      title="Delete workload?"
    >
      This will delete{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>
      {resolvedKind ? (
        <>
          {" "}
          (<span className="font-mono">{resolvedKind}</span>)
        </>
      ) : null}{" "}
      from the project.
    </ProjectCanvasDeleteDialog>
  );
}

function ProjectCanvasDbDeleteDialog({
  onConfirm,
  onOpenChange,
  target,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  target: ProjectCanvasDbDeleteTarget | null;
}) {
  if (target == null) {
    return null;
  }

  return (
    <ProjectCanvasDeleteDialog
      dataSlot="project-canvas-db-delete-dialog"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open
      title="Delete DB Service?"
    >
      This will delete{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>{" "}
      from the project. DB resources and stored data may be removed depending on
      the termination policy.
    </ProjectCanvasDeleteDialog>
  );
}
