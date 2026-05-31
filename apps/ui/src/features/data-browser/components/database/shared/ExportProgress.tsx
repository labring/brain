import { Button } from "@data-browser/components/ui/Button";
import { DialogClose, DialogFooter } from "@data-browser/components/ui/dialog";
import { useModalForm } from "@data-browser/components/ui/ModalForm";
import { CheckCircle, Download, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// ExportProgress — spinner / success status display
// ---------------------------------------------------------------------------

interface ExportProgressProps {
  /** Whether an export operation is currently running. */
  isExporting: boolean;
  /** Whether the export completed successfully. */
  isSuccess: boolean;
  /** Descriptive text shown alongside the spinner (e.g., "Exporting table 2 of 5..."). */
  statusText?: string;
}

/** Displays export status: spinner during export, success message on completion. Returns `null` when idle. */
export function ExportProgress({
  isExporting,
  isSuccess,
  statusText,
}: ExportProgressProps) {
  if (!(isExporting || isSuccess)) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 pt-2 text-sm">
      {isExporting && (
        <>
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-muted-foreground">
            {statusText ?? "Exporting..."}
          </span>
        </>
      )}
      {!isExporting && isSuccess && (
        <>
          <CheckCircle className="h-4 w-4 text-green-500" />
          <span className="font-medium text-green-500">
            {"Export complete"}
          </span>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExportFooter — Start Export / Exporting... / Close button logic
// ---------------------------------------------------------------------------

interface ExportFooterProps {
  /** When true, shows only a Close button. When false, shows Cancel + Start Export. */
  isSuccess: boolean;
  /** Click handler for the export button. Falls back to `actions.submit` from ModalForm context. */
  onClick?: () => void;
}

/**
 * Footer for export modals. Reads `isSubmitting` from ModalForm context.
 * Shows "Start Export" when idle, spinner when exporting, "Close" after success.
 */
export function ExportFooter({ isSuccess, onClick }: ExportFooterProps) {
  const { state, actions } = useModalForm();
  const handleClick = onClick ?? actions.submit;

  if (isSuccess) {
    return (
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">{"Close"}</Button>
        </DialogClose>
      </DialogFooter>
    );
  }

  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button disabled={state.isSubmitting} type="button" variant="outline">
          {"Cancel"}
        </Button>
      </DialogClose>
      <Button
        className="gap-2"
        disabled={state.isSubmitting}
        onClick={handleClick}
      >
        {state.isSubmitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        {state.isSubmitting ? "Exporting..." : "Start export"}
      </Button>
    </DialogFooter>
  );
}
