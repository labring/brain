"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppInput } from "@workspace/ui/components/app-input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { LayoutGrid, Plus, Search } from "lucide-react";
import type { ComponentProps } from "react";

import { useProjectExplorer } from "./project-explorer.context";

/** Title row: grid icon + “Projects” label + optional subtitle. */
export function ProjectExplorerHeaderBrand({
  className,
  description,
  label = "Projects",
  ...props
}: ComponentProps<"div"> & { description?: string; label?: string }) {
  return (
    <div
      className={cn("flex flex-col gap-1", className)}
      data-slot="project-explorer-header-brand"
      {...props}
    >
      <div className="flex items-center gap-2">
        <LayoutGrid aria-hidden className="size-5 shrink-0 text-foreground" />
        <div className="text-start font-semibold text-2xl text-foreground">
          {label}
        </div>
      </div>
      {description ? (
        <p className="text-muted-foreground text-sm">{description}</p>
      ) : null}
    </div>
  );
}

/** Second-row wrapper: search + actions (`min-w-0` flex row). */
export function ProjectExplorerHeaderToolbar({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "project-explorer-header-toolbar flex min-w-0 flex-nowrap items-center gap-2",
        className
      )}
      data-slot="project-explorer-header-toolbar"
      {...props}
    />
  );
}

/** Search field wired to explorer context (`searchQuery` / `setSearchQuery`). */
export function ProjectExplorerSearchField({
  className,
  placeholder = "Search projects…",
  ...props
}: Omit<ComponentProps<typeof AppInput>, "onChange" | "type" | "value"> & {
  placeholder?: string;
}) {
  const { searchQuery, setSearchQuery } = useProjectExplorer();

  return (
    <div
      className={cn("relative min-w-0 flex-1", className)}
      data-slot="project-explorer-search-field"
    >
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <AppInput
        aria-label="Search projects"
        className="pl-9 shadow-xs"
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={placeholder}
        type="search"
        value={searchQuery}
        {...props}
      />
    </div>
  );
}

/** Primary “New project” control; calls `actions.onNewProject` when set. */
export function ProjectExplorerNewProjectButton({
  className,
  children,
  ...props
}: ComponentProps<typeof AppButton>) {
  const { actions } = useProjectExplorer();
  const { onClick, ...rest } = props;
  const defaultContent = children == null;

  const button = (
    <AppButton
      aria-label={defaultContent ? "New Project" : undefined}
      className={cn(
        "h-9 bg-blue-500 text-sm text-white hover:bg-blue-500/90",
        defaultContent
          ? "project-explorer-new-project-button justify-start gap-1.5 overflow-hidden px-3"
          : "gap-1.5 px-3",
        className
      )}
      size="lg"
      type="button"
      variant="secondary"
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          actions.onNewProject?.();
        }
      }}
    >
      {children ?? (
        <>
          <Plus aria-hidden className="size-4" />
          <span className="project-explorer-new-project-label shrink-0 whitespace-nowrap">
            New Project
          </span>
        </>
      )}
    </AppButton>
  );

  if (!defaultContent) {
    return button;
  }

  return (
    <div
      className="project-explorer-new-project-action min-w-9"
      data-slot="project-explorer-new-project-action"
    >
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>New Project</TooltipContent>
      </Tooltip>
    </div>
  );
}
