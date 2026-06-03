"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { cn } from "@workspace/ui/lib/utils";

export function CanvasErrorFallback({
  error,
  reset,
  className,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** Merged with default layout; omit for full-viewport route errors. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-4 p-6 text-center",
        className ?? "h-dvh"
      )}
    >
      <h1 className="font-medium text-lg">Canvas failed to load</h1>
      <p className="max-w-md text-muted-foreground text-sm">{error.message}</p>
      <AppButton onClick={reset} variant="secondary">
        Try again
      </AppButton>
    </div>
  );
}
