"use client";

import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { useAtomValue } from "jotai";
import { Database, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

import { DataBrowserPane } from "@/features/data-browser/DataBrowserPane";
import type { ProjectCanvasMainRenderModel } from "@/features/project-canvas/surface/rendering-adapter";
import { assistantPaneOpenAtom } from "@/store/layout-store";

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
      className="dark absolute inset-0 z-30 flex min-h-0 min-w-0 flex-col overflow-hidden bg-neutral-950 text-foreground"
      data-slot="main-action-surface"
    >
      <header
        className={cn(
          "grid h-13 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center border-border border-b py-0 pr-4 pl-4",
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
            className="min-w-0 truncate font-medium text-base text-foreground leading-none"
            title={title}
          >
            {title}
          </h2>
        </div>
        <p
          className="min-w-0 truncate px-4 text-center text-primary text-sm leading-5"
          title={subtitle}
        >
          {subtitle}
        </p>
        <div className="flex min-w-0 justify-end">
          <Button
            aria-label={closeAriaLabel}
            className="hoverable size-7 shrink-0 text-muted-foreground hover:text-foreground"
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
          "main-action-surface-body-background min-h-0 flex-1",
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
  projectUid: string;
}

export function MainActionSurface({
  dbAccessEnabled = true,
  kubeconfig,
  model,
  namespace,
  onClose,
  projectUid,
}: MainActionSurfaceProps) {
  const open = dbAccessEnabled && model != null;

  const { states } = model?.databaseData ?? { states: null };
  const subtitle =
    states == null
      ? undefined
      : `Database ${states.displayEngine}${states.formattedVersion ? ` ${states.formattedVersion}` : ""}`;

  return (
    <MainActionSurfaceFrame
      icon={<Database aria-hidden className="size-4" strokeWidth={2} />}
      onClose={onClose}
      open={open}
      subtitle={subtitle}
      title={states?.name ?? ""}
    >
      {model == null ? null : (
        <DataBrowserPane
          kubeconfig={kubeconfig}
          namespace={namespace}
          projectUid={projectUid}
          selectedDatabaseData={model.databaseData}
        />
      )}
    </MainActionSurfaceFrame>
  );
}
