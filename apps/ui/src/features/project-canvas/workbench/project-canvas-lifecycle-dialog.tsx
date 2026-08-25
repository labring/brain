"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import type { ReactNode } from "react";
import { resourceNameDetailSuffix } from "./resource-name-detail";

export interface ProjectCanvasApLifecycleTarget {
  displayName: string;
  kind?: string;
  name: string;
  namespace: string;
}

export interface ProjectCanvasDbLifecycleTarget {
  displayName: string;
  name: string;
  namespace: string;
}

export interface ProjectCanvasLifecycleDialogsProps {
  apRestartTarget: ProjectCanvasApLifecycleTarget | null;
  apStopTarget: ProjectCanvasApLifecycleTarget | null;
  dbRestartTarget: ProjectCanvasDbLifecycleTarget | null;
  dbStopTarget: ProjectCanvasDbLifecycleTarget | null;
  onApRestartConfirm: () => void;
  onApRestartOpenChange: (open: boolean) => void;
  onApStopConfirm: () => void;
  onApStopOpenChange: (open: boolean) => void;
  onDbRestartConfirm: () => void;
  onDbRestartOpenChange: (open: boolean) => void;
  onDbStopConfirm: () => void;
  onDbStopOpenChange: (open: boolean) => void;
}

export function ProjectCanvasLifecycleDialogs({
  apRestartTarget,
  apStopTarget,
  dbRestartTarget,
  dbStopTarget,
  onApRestartConfirm,
  onApRestartOpenChange,
  onApStopConfirm,
  onApStopOpenChange,
  onDbRestartConfirm,
  onDbRestartOpenChange,
  onDbStopConfirm,
  onDbStopOpenChange,
}: ProjectCanvasLifecycleDialogsProps) {
  return (
    <>
      <ProjectCanvasApRestartDialog
        onConfirm={onApRestartConfirm}
        onOpenChange={onApRestartOpenChange}
        target={apRestartTarget}
      />
      <ProjectCanvasApStopDialog
        onConfirm={onApStopConfirm}
        onOpenChange={onApStopOpenChange}
        target={apStopTarget}
      />
      <ProjectCanvasDbRestartDialog
        onConfirm={onDbRestartConfirm}
        onOpenChange={onDbRestartOpenChange}
        target={dbRestartTarget}
      />
      <ProjectCanvasDbStopDialog
        onConfirm={onDbStopConfirm}
        onOpenChange={onDbStopOpenChange}
        target={dbStopTarget}
      />
    </>
  );
}

function ProjectCanvasLifecycleDialog({
  actionLabel,
  children,
  dataSlot,
  onConfirm,
  onOpenChange,
  title,
}: {
  actionLabel: string;
  children: ReactNode;
  dataSlot: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  title: string;
}) {
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
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
          <AppDialog.Action onClick={onConfirm} type="button">
            {actionLabel}
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

function ProjectCanvasApRestartDialog({
  onConfirm,
  onOpenChange,
  target,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  target: ProjectCanvasApLifecycleTarget | null;
}) {
  if (target == null) {
    return null;
  }

  return (
    <ProjectCanvasLifecycleDialog
      actionLabel="Restart"
      dataSlot="project-canvas-ap-restart-dialog"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      title="Restart workload?"
    >
      This will restart{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>
      {resourceNameDetailSuffix(target)}. Running replicas and app traffic may
      be briefly interrupted while the workload rolls out.
    </ProjectCanvasLifecycleDialog>
  );
}

function ProjectCanvasApStopDialog({
  onConfirm,
  onOpenChange,
  target,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  target: ProjectCanvasApLifecycleTarget | null;
}) {
  if (target == null) {
    return null;
  }

  return (
    <ProjectCanvasLifecycleDialog
      actionLabel="Stop"
      dataSlot="project-canvas-ap-stop-dialog"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      title="Stop workload?"
    >
      This will stop{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>
      {resourceNameDetailSuffix(target)}. Running replicas and app traffic may
      be interrupted until it is started again.
    </ProjectCanvasLifecycleDialog>
  );
}

function ProjectCanvasDbRestartDialog({
  onConfirm,
  onOpenChange,
  target,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  target: ProjectCanvasDbLifecycleTarget | null;
}) {
  if (target == null) {
    return null;
  }

  return (
    <ProjectCanvasLifecycleDialog
      actionLabel="Restart"
      dataSlot="project-canvas-db-restart-dialog"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      title="Restart DB Service?"
    >
      This will restart{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>
      {resourceNameDetailSuffix(target)}. Database connections may be briefly
      interrupted while the DB Service restarts.
    </ProjectCanvasLifecycleDialog>
  );
}

function ProjectCanvasDbStopDialog({
  onConfirm,
  onOpenChange,
  target,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  target: ProjectCanvasDbLifecycleTarget | null;
}) {
  if (target == null) {
    return null;
  }

  return (
    <ProjectCanvasLifecycleDialog
      actionLabel="Stop"
      dataSlot="project-canvas-db-stop-dialog"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      title="Stop DB Service?"
    >
      This will stop{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>
      {resourceNameDetailSuffix(target)}. Database connections will be
      unavailable until it is started again.
    </ProjectCanvasLifecycleDialog>
  );
}
