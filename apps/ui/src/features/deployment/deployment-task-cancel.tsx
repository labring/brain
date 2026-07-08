"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { type ReactNode, useCallback, useState } from "react";

export function DeploymentTaskCancelDialog({
  onConfirm,
  onOpenChange,
}: {
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open>
      <AppDialog.Content data-slot="deployment-task-cancel-dialog">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>Cancel this deployment?</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            This stops the deployment. Resources that were already applied are
            kept and never rolled back.
          </AppDialog.Description>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel>Keep Deploying</AppDialog.Cancel>
          <AppDialog.Action onClick={onConfirm} type="button">
            Cancel Deployment
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

/**
 * Gate a cancel action behind the confirmation dialog: every invocation
 * opens the dialog first and the action runs only on confirm. Unlike the
 * redeploy overwrite gate this is unconditional — stopping an in-flight
 * deployment always warrants a confirm (dock and timeline pane share it).
 */
export function useCancelConfirmGate(): {
  dialog: ReactNode;
  gate: (run: () => void) => void;
} {
  const [pendingRun, setPendingRun] = useState<(() => void) | null>(null);
  const gate = useCallback((run: () => void) => {
    setPendingRun(() => run);
  }, []);
  const dialog =
    pendingRun == null ? null : (
      <DeploymentTaskCancelDialog
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
