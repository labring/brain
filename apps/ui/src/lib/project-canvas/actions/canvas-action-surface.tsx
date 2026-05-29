"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { Database, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { DataBrowserPane } from "@/features/data-browser/DataBrowserPane";
import type { CanvasDatabaseNodeData } from "@/lib/project-canvas/nodes/types";
import { CANVAS_ACTION } from "@/store/canvas-store";
import { assistantPaneOpenAtom } from "@/store/layout-store";

export interface CanvasActionSurfaceFrameProps {
  bodyClassName?: string;
  children: ReactNode;
  closeAriaLabel?: string;
  icon?: ReactNode;
  label?: string;
  onClose: () => void;
  open: boolean;
  subtitle?: string;
  title: string;
}

export function CanvasActionSurfaceFrame({
  bodyClassName,
  children,
  closeAriaLabel = "Close canvas action surface",
  icon,
  label = "Canvas action surface",
  onClose,
  open,
  subtitle,
  title,
}: CanvasActionSurfaceFrameProps) {
  const assistantPaneOpen = useAtomValue(assistantPaneOpenAtom);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <section
      aria-label={label}
      className="resource-pane-surface absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col overflow-hidden bg-resource-pane text-resource-pane-foreground"
      data-slot="canvas-action-surface"
    >
      <header
        className={cn(
          "grid h-13 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center border-resource-pane-border border-b py-0 pr-4 pl-4",
          !assistantPaneOpen && "pr-12"
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {icon == null ? null : (
            <span className="flex size-4 shrink-0 items-center justify-center text-blue-400">
              {icon}
            </span>
          )}
          <h2
            className="min-w-0 truncate font-medium text-base text-resource-pane-foreground leading-none"
            title={title}
          >
            {title}
          </h2>
        </div>
        <p
          className="min-w-0 truncate px-4 text-center text-resource-pane-primary text-sm leading-5"
          title={subtitle}
        >
          {subtitle}
        </p>
        <div className="flex min-w-0 justify-end">
          <Button
            aria-label={closeAriaLabel}
            className="hoverable size-7 shrink-0 text-resource-pane-muted hover:text-resource-pane-foreground"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      </header>
      <div
        className={cn(
          "canvas-action-surface-body-background min-h-0 flex-1",
          bodyClassName
        )}
        data-slot="canvas-action-surface-body"
      >
        {children}
      </div>
    </section>
  );
}

export interface CanvasActionSurfaceProps {
  action: string | null | undefined;
  dbAccessEnabled?: boolean;
  kubeconfig: string;
  namespace: string;
  onClose: () => void;
  projectUid: string;
  selectedDatabaseData: CanvasDatabaseNodeData | null;
}

export function CanvasActionSurface({
  action,
  dbAccessEnabled = true,
  kubeconfig,
  namespace,
  onClose,
  projectUid,
  selectedDatabaseData,
}: CanvasActionSurfaceProps) {
  const open =
    dbAccessEnabled &&
    action === CANVAS_ACTION.dbAccess &&
    selectedDatabaseData != null;

  const { states } = selectedDatabaseData ?? { states: null };
  const subtitle =
    states == null
      ? undefined
      : `Database ${states.displayEngine}${states.formattedVersion ? ` ${states.formattedVersion}` : ""}`;

  return (
    <CanvasActionSurfaceFrame
      icon={<Database aria-hidden className="size-4" strokeWidth={2} />}
      onClose={onClose}
      open={open}
      subtitle={subtitle}
      title={states?.name ?? ""}
    >
      {selectedDatabaseData == null ? null : (
        <DataBrowserPane
          kubeconfig={kubeconfig}
          namespace={namespace}
          projectUid={projectUid}
          selectedDatabaseData={selectedDatabaseData}
        />
      )}
    </CanvasActionSurfaceFrame>
  );
}
