"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { deployTaskHasAppliedResources } from "@/features/deploy/task/status-presentation";
import type {
  DeploymentTaskSource,
  DeployTaskDTO,
} from "@/features/deploy/task/types";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";

/**
 * One edited-redeploy gesture (US10): held in React state at the workbench
 * (never in the URL-coded surface state), consumed once by the deployment
 * pane it opens, cleared when that pane closes or switches.
 */
export interface DeploymentTaskEditRedeploy {
  /** Predecessor applied resources exist — warn before overwriting (US12). */
  overwriteWarning: boolean;
  predecessorTaskId: string;
  source: DeploymentTaskSource;
}

/** The one-line overwrite warning (US12) — dialog and inline forms share it. */
export const REDEPLOY_OVERWRITE_WARNING =
  "This redeploy reapplies onto the resources the previous run created — manual edits made after that run may be overwritten.";

/** The deployment pane surface able to edit a task's source, if any. */
export function editRedeploySurfaceKind(
  sourceKind: DeploymentTaskSource["kind"]
): Extract<
  ProjectSideSurfaceEntry["kind"],
  | "databaseDeployment"
  | "dockerDeployment"
  | "githubDeployment"
  | "templateDeployment"
> | null {
  switch (sourceKind) {
    case "database":
      return "databaseDeployment";
    case "docker":
      return "dockerDeployment";
    case "github":
      return "githubDeployment";
    case "template":
      return "templateDeployment";
    case "prompt":
      return null;
    default:
      return sourceKind satisfies never;
  }
}

export function DeploymentTaskRedeployOverwriteDialog({
  onConfirm,
  onOpenChange,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
      <AppDialog.Content data-slot="deployment-task-redeploy-dialog">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>Redeploy onto existing resources?</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            {REDEPLOY_OVERWRITE_WARNING}
          </AppDialog.Description>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel>Cancel</AppDialog.Cancel>
          <AppDialog.Action onClick={onConfirm} type="button">
            Redeploy
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

/**
 * Owns one edited-redeploy gesture for the canvas workbench: records the
 * prefill, opens the matching deployment pane, and clears the prefill once
 * that pane closes or the side surface moves elsewhere. The armed flag
 * tolerates the render gap between dispatching the surface intent and the
 * pane actually appearing.
 */
export function useEditRedeployController(input: {
  onOpenSurface: (
    entry: Extract<
      ProjectSideSurfaceEntry,
      {
        kind:
          | "databaseDeployment"
          | "dockerDeployment"
          | "githubDeployment"
          | "templateDeployment";
      }
    >
  ) => void;
  projectId: string;
  sideEntryKind: string | null;
}): {
  editRedeploy: DeploymentTaskEditRedeploy | null;
  onEditRedeploy: (task: DeployTaskDTO) => void;
} {
  const { onOpenSurface, projectId, sideEntryKind } = input;
  const [editRedeploy, setEditRedeploy] =
    useState<DeploymentTaskEditRedeploy | null>(null);
  const armedRef = useRef(false);

  const onEditRedeploy = useCallback(
    (task: DeployTaskDTO) => {
      const surfaceKind = editRedeploySurfaceKind(task.source.kind);
      if (surfaceKind == null) {
        return;
      }
      armedRef.current = false;
      setEditRedeploy({
        overwriteWarning: deployTaskHasAppliedResources(task),
        predecessorTaskId: task.id,
        source: task.source,
      });
      onOpenSurface({ kind: surfaceKind, projectId });
    },
    [onOpenSurface, projectId]
  );

  const expectedKind =
    editRedeploy == null
      ? null
      : editRedeploySurfaceKind(editRedeploy.source.kind);
  useEffect(() => {
    if (expectedKind == null) {
      return;
    }
    if (sideEntryKind === expectedKind) {
      armedRef.current = true;
      return;
    }
    if (armedRef.current) {
      armedRef.current = false;
      setEditRedeploy(null);
    }
  }, [expectedKind, sideEntryKind]);

  return { editRedeploy, onEditRedeploy };
}

/**
 * Gate an action behind the overwrite warning (US12): when `active`, the
 * first invocation opens the dialog and the action runs on confirm; when
 * inactive the action runs immediately (true one-click).
 */
export function useRedeployOverwriteGate(active: boolean): {
  dialog: ReactNode;
  gate: (run: () => void) => void;
} {
  const [pendingRun, setPendingRun] = useState<(() => void) | null>(null);
  const gate = useCallback(
    (run: () => void) => {
      if (active) {
        setPendingRun(() => run);
        return;
      }
      run();
    },
    [active]
  );
  const dialog =
    pendingRun == null ? null : (
      <DeploymentTaskRedeployOverwriteDialog
        onConfirm={() => {
          setPendingRun(null);
          pendingRun();
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRun(null);
          }
        }}
      />
    );
  return { dialog, gate };
}
