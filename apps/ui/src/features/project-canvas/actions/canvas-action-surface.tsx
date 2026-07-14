"use client";

import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { Database, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import {
  DataBrowserPane,
  type DataBrowserPaneProps,
} from "@/features/db-browser/DataBrowserPane";
import { assistantPaneOpenAtom } from "@/features/panes/layout-store";
import type { ProjectCanvasMainRenderModel } from "@/features/project-canvas/surface/rendering-adapter";

export interface MainActionSurfaceFrameProps {
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

export function MainActionSurfaceFrame({
  bodyClassName,
  children,
  closeAriaLabel = "Close Main Action Surface",
  icon,
  label = "Main Action Surface",
  onClose,
  open,
  subtitle,
  title,
}: MainActionSurfaceFrameProps) {
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
      className="dark main-action-surface-background absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-950 text-foreground"
      data-slot="main-action-surface"
    >
      <header
        className={cn(
          "relative z-10 grid h-13 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center border-border border-b py-0 pr-4 pl-4",
          !assistantPaneOpen && "pr-12"
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          {icon == null ? null : (
            <span className="flex size-4 shrink-0 items-center justify-center text-blue-400">
              {icon}
            </span>
          )}
          <h2
            className="min-w-0 truncate font-semibold text-foreground text-lg leading-none"
            title={title}
          >
            {title}
          </h2>
        </div>
        <p
          className="min-w-0 truncate px-4 text-center font-medium text-primary text-sm leading-5"
          title={subtitle}
        >
          {subtitle}
        </p>
        <div className="flex min-w-0 justify-end">
          <AppIconButton
            aria-label={closeAriaLabel}
            className="shrink-0"
            onClick={onClose}
            size="lg"
            type="button"
            variant="quiet"
          >
            <X aria-hidden className="size-4" />
          </AppIconButton>
        </div>
      </header>
      <div
        className={cn(
          "main-action-surface-body-background relative z-10 min-h-0 flex-1",
          bodyClassName
        )}
        data-slot="main-action-surface-body"
      >
        {children}
      </div>
    </section>
  );
}

export interface MainActionSurfaceProps {
  dbAccessEnabled?: boolean;
  kubeconfig: string;
  model:
    | Extract<ProjectCanvasMainRenderModel, { kind: "dbAccess" }>
    | null
    | undefined;
  namespace: string;
  onClose: () => void;
  onDbServiceRestoreAccepted?: DataBrowserPaneProps["onDbServiceRestoreAccepted"];
  projectId: string;
  refreshProjectCanvas?: () => Promise<unknown>;
}

export function MainActionSurface({
  dbAccessEnabled = true,
  kubeconfig,
  model,
  namespace,
  onClose,
  onDbServiceRestoreAccepted,
  refreshProjectCanvas,
  projectId,
}: MainActionSurfaceProps) {
  const open = dbAccessEnabled && model != null;

  const { states } = model?.databaseData ?? { states: null };

  return (
    <MainActionSurfaceFrame
      icon={<Database aria-hidden className="size-4" strokeWidth={2} />}
      onClose={onClose}
      open={open}
      subtitle={states?.name}
      title="DB Access"
    >
      {model == null ? null : (
        <DataBrowserPane
          kubeconfig={kubeconfig}
          namespace={namespace}
          onDbServiceRestoreAccepted={onDbServiceRestoreAccepted}
          projectId={projectId}
          refreshProjectCanvas={refreshProjectCanvas}
          selectedDatabaseData={model.databaseData}
        />
      )}
    </MainActionSurfaceFrame>
  );
}
