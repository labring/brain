import { AppButton } from "@workspace/ui/components/app-button";
import { Database } from "lucide-react";

interface DataViewErrorProps {
  message: string;
  onRetry?: () => void;
}

/** Error card with optional retry button for data views. */
export function DataViewError({ message, onRetry }: DataViewErrorProps) {
  return (
    <div
      className="flex h-full items-center justify-center bg-muted/5"
      data-qa-error-code="data_load_failed"
      data-qa-module="data-view"
      data-qa-object="data-load"
      data-qa-state="error"
      data-testid="data-view.error"
    >
      <div className="rounded-xl border bg-background p-8 text-center shadow-sm">
        <Database className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground text-sm">{message}</p>
        {onRetry && (
          <AppButton
            className="mt-4"
            data-qa-action="retry"
            data-qa-module="data-view"
            data-qa-object="data-load"
            data-testid="data-view.retry-button"
            onClick={onRetry}
            variant="quiet"
          >
            {"Retry"}
          </AppButton>
        )}
      </div>
    </div>
  );
}
