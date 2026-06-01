"use client";

import { AppDialog } from "@workspace/ui/components/app-dialog";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";

const DELETE_TITLE = "Delete database?";

function DatabaseDeleteCopy({ name }: { name: string }) {
  return (
    <>
      This will delete{" "}
      <span className="font-medium text-foreground">{name}</span> from the
      project. Database resources and stored data may be removed depending on
      the termination policy.
    </>
  );
}

export interface DatabaseNodeDeleteDialogPanelProps {
  className?: string;
  name: string;
  onCancel: () => void;
  onConfirmDelete?: () => void;
}

export function DatabaseNodeDeleteDialogPanel({
  className,
  name,
  onCancel,
  onConfirmDelete,
}: DatabaseNodeDeleteDialogPanelProps) {
  return (
    <div
      className={cn(
        "grid w-full max-w-md gap-6 rounded-xl bg-background p-6 text-sm ring-1 ring-foreground/10",
        className
      )}
    >
      <div className="flex flex-col gap-2">
        <h3 className="font-medium leading-none">{DELETE_TITLE}</h3>
        <p className="text-balance text-muted-foreground text-sm md:text-pretty">
          <DatabaseDeleteCopy name={name} />
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={onCancel} variant="outline">
          Cancel
        </Button>
        <Button
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          onClick={() => onConfirmDelete?.()}
          type="button"
          variant="destructive"
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

export interface DatabaseNodeDeleteDialogProps {
  name: string;
  onConfirmDelete?: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export function DatabaseNodeDeleteDialog({
  name,
  onConfirmDelete,
  onOpenChange,
  open,
}: DatabaseNodeDeleteDialogProps) {
  return (
    <AppDialog.Root onOpenChange={onOpenChange} open={open}>
      <AppDialog.Content data-slot="database-node-delete-dialog">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>{DELETE_TITLE}</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            <DatabaseDeleteCopy name={name} />
          </AppDialog.Description>
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel>Cancel</AppDialog.Cancel>
          <AppDialog.DestructiveAction
            onClick={() => {
              onConfirmDelete?.();
              onOpenChange(false);
            }}
            type="button"
          >
            Delete
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

DatabaseNodeDeleteDialog.displayName = "DatabaseNodeDeleteDialog";
DatabaseNodeDeleteDialogPanel.displayName = "DatabaseNodeDeleteDialogPanel";
