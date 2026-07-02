"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import type { ReactNode } from "react";

export interface ProjectCanvasApStopTarget {
  displayName: string;
  kind?: string;
  name: string;
  namespace: string;
}

export interface ProjectCanvasDbStopTarget {
  displayName: string;
  name: string;
  namespace: string;
}

export interface ProjectCanvasStopDialogsProps {
  apTarget: ProjectCanvasApStopTarget | null;
  dbTarget: ProjectCanvasDbStopTarget | null;
  onApConfirm: () => void;
  onApOpenChange: (open: boolean) => void;
  onDbConfirm: () => void;
  onDbOpenChange: (open: boolean) => void;
}

export function ProjectCanvasStopDialogs({
  apTarget,
  dbTarget,
  onApConfirm,
  onApOpenChange,
  onDbConfirm,
  onDbOpenChange,
}: ProjectCanvasStopDialogsProps) {
  return (
    <>
      <ProjectCanvasApStopDialog
        onConfirm={onApConfirm}
        onOpenChange={onApOpenChange}
        target={apTarget}
      />
      <ProjectCanvasDbStopDialog
        onConfirm={onDbConfirm}
        onOpenChange={onDbOpenChange}
        target={dbTarget}
      />
    </>
  );
}

function ProjectCanvasStopDialog({
  children,
  dataSlot,
  onConfirm,
  onOpenChange,
  title,
}: {
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
            Stop
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

function ProjectCanvasApStopDialog({
  onConfirm,
  onOpenChange,
  target,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  target: ProjectCanvasApStopTarget | null;
}) {
  if (target == null) {
    return null;
  }
  const resolvedKind = target.kind?.trim();

  return (
    <ProjectCanvasStopDialog
      dataSlot="project-canvas-ap-stop-dialog"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      title="Stop workload?"
    >
      This will stop{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>
      {resolvedKind ? (
        <>
          {" "}
          (<span className="font-mono">{resolvedKind}</span>)
        </>
      ) : null}
      . Running replicas and app traffic may be interrupted until it is started
      again.
    </ProjectCanvasStopDialog>
  );
}

function ProjectCanvasDbStopDialog({
  onConfirm,
  onOpenChange,
  target,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  target: ProjectCanvasDbStopTarget | null;
}) {
  if (target == null) {
    return null;
  }

  return (
    <ProjectCanvasStopDialog
      dataSlot="project-canvas-db-stop-dialog"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      title="Stop DB Service?"
    >
      This will stop{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>.
      Database connections will be unavailable until it is started again.
    </ProjectCanvasStopDialog>
  );
}
