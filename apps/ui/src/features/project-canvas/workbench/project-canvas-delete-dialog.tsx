"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { type ReactNode, useState } from "react";

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
  verificationText: string;
}

function ProjectCanvasDeleteDialog({
  children,
  dataSlot,
  onConfirm,
  onOpenChange,
  open,
  title,
  verificationText,
}: ProjectCanvasDeleteDialogProps) {
  const [verificationValue, setVerificationValue] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);
  const confirmDisabled = verificationValue !== verificationText;

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setVerificationValue("");
    }
  }

  return (
    <AppDialog.Root onOpenChange={onOpenChange} open={open}>
      <AppDialog.Content data-slot={dataSlot}>
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>{title}</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>{children}</AppDialog.Description>
          <AppDialog.Field>
            <p className="select-text text-sm/5 text-zinc-400">
              Type{" "}
              <span className="font-mono text-zinc-100">
                {verificationText}
              </span>{" "}
              to confirm.
            </p>
            <AppDialog.Input
              aria-label={`Type ${verificationText} to confirm.`}
              autoComplete="off"
              className="font-mono"
              onChange={(event) => setVerificationValue(event.target.value)}
              placeholder={verificationText}
              type="text"
              value={verificationValue}
            />
          </AppDialog.Field>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel>Cancel</AppDialog.Cancel>
          <AppDialog.DestructiveAction
            disabled={confirmDisabled}
            onClick={onConfirm}
            type="button"
          >
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
  // Destructive confirmations show the Kubernetes name next to the display
  // name (ADR 0062) so a renamed or duplicated node cannot be mistaken.
  const detail = [resolvedKind, kubernetesNameDetail(target)]
    .filter(Boolean)
    .join(" · ");

  return (
    <ProjectCanvasDeleteDialog
      dataSlot="project-canvas-ap-delete-dialog"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open
      title="Delete workload?"
      verificationText={target.displayName}
    >
      This will delete{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>
      {detail ? (
        <>
          {" "}
          (<span className="font-mono">{detail}</span>)
        </>
      ) : null}{" "}
      from the project.
    </ProjectCanvasDeleteDialog>
  );
}

function kubernetesNameDetail(target: {
  displayName: string;
  name: string;
}): string | undefined {
  return target.name === target.displayName ? undefined : target.name;
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
      verificationText={target.displayName}
    >
      This will delete{" "}
      <span className="font-medium text-foreground">{target.displayName}</span>
      {kubernetesNameDetail(target) ? (
        <>
          {" "}
          (<span className="font-mono">{kubernetesNameDetail(target)}</span>)
        </>
      ) : null}{" "}
      from the project. DB resources and stored data may be removed depending on
      the termination policy.
    </ProjectCanvasDeleteDialog>
  );
}
