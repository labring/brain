"use client";

import { Button } from "@workspace/ui/components/button";
import { useHydrated } from "@workspace/ui/hooks/use-hydrated";
import { cn } from "@workspace/ui/lib/utils";
import { Maximize2, Minimize2, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

function PreviewWrapper({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <div
        className={cn(
          "mx-auto grid w-full min-w-0 max-w-7xl auto-rows-auto content-start items-stretch gap-8 p-4 pt-2 sm:gap-12 sm:p-6 md:gap-8 lg:p-12 2xl:max-w-6xl",
          className
        )}
        data-slot="preview-wrapper"
      >
        {children}
      </div>
    </div>
  );
}

function Preview({
  title,
  children,
  className,
  containerClassName,
  /** Merged into fullscreen preview content only — use to override embedded `className` sizing. */
  maximizedClassName,
  showMaximize = false,
  showReset = false,
  onReset,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  containerClassName?: string;
  maximizedClassName?: string;
  /** When true, shows a control that opens this preview in a full-screen overlay. */
  showMaximize?: boolean;
  showReset?: boolean;
  /** Called when the user resets the preview (after remount key bumps). */
  onReset?: () => void;
}) {
  const [resetKey, setResetKey] = useState(0);
  const [isMaximized, setIsMaximized] = useState(false);
  const mounted = useHydrated();

  // Losing the maximize control also exits full-screen; adjust during render
  // so the overlay never paints without its control.
  if (!showMaximize && isMaximized) {
    setIsMaximized(false);
  }

  useEffect(() => {
    if (!(showMaximize && isMaximized)) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMaximized, showMaximize]);

  useEffect(() => {
    if (!(showMaximize && isMaximized)) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsMaximized(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMaximized, showMaximize]);

  const contentClassName = cn(
    "flex min-w-0 flex-col items-stretch gap-6 border border-dashed bg-background p-4 text-foreground sm:p-6 *:[div:not([class*='w-'])]:w-full",
    className
  );

  const maximizedContentClassName = cn(
    "flex min-h-0 min-w-0 flex-1 flex-col items-stretch gap-6 bg-background p-2 text-foreground *:[div:not([class*='w-'])]:w-full",
    className,
    maximizedClassName
  );

  return (
    <>
      <div
        className={cn(
          "mx-auto flex min-h-0 w-full min-w-0 max-w-5xl flex-col gap-1 self-stretch lg:max-w-none",
          containerClassName,
          showMaximize && isMaximized && "hidden"
        )}
        data-slot="preview"
      >
        <div className="flex items-center justify-between gap-2 px-1.5 py-2">
          <span className="font-medium text-muted-foreground text-xs">
            {title}
          </span>
          <div className="flex items-center gap-0.5">
            {showMaximize ? (
              <Button
                aria-label={`Maximize preview: ${title}`}
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={() => setIsMaximized(true)}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <Maximize2 className="size-3.5" />
              </Button>
            ) : null}
            {showReset ? (
              <Button
                aria-label="Reset preview"
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setResetKey((k) => k + 1);
                  onReset?.();
                  toast(`Preview Reset: ${title}`);
                }}
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                <RotateCcw className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
        {showMaximize && isMaximized ? null : (
          <div
            className={contentClassName}
            data-slot="preview-content"
            key={resetKey}
          >
            {children}
          </div>
        )}
      </div>
      {mounted && showMaximize && isMaximized
        ? createPortal(
            <div
              aria-label={title}
              aria-modal="true"
              className="fixed inset-0 z-40 flex flex-col bg-background"
              role="dialog"
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-3 py-2">
                <span className="truncate font-medium text-muted-foreground text-xs">
                  {title}
                </span>
                <Button
                  aria-label={`Minimize preview: ${title}`}
                  className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                  onClick={() => setIsMaximized(false)}
                  size="icon-xs"
                  type="button"
                  variant="ghost"
                >
                  <Minimize2 className="size-3.5" />
                </Button>
              </div>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div
                  className={maximizedContentClassName}
                  data-slot="preview-content"
                  key={resetKey}
                >
                  {children}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export { Preview, PreviewWrapper };
