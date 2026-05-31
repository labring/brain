"use client";

import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { cn } from "@workspace/ui/lib/utils";
import { type LucideIcon, MoreHorizontal, Trash2 } from "lucide-react";
import type { ComponentProps, SyntheticEvent } from "react";

/**
 * React Flow utility classes — required for controls inside custom nodes so pointer
 * events are not consumed for drag/pan. Prefer these over `stopPropagation` on the
 * trigger, which can break Base UI menu triggers. See:
 * https://reactflow.dev/learn/customization/utility-classes
 */
const RF_MENU_SURFACE_CLASS = "nodrag nopan";

function stopCanvasNodeClick(e: SyntheticEvent) {
  e.stopPropagation();
}

/** Root — compose with `HeaderMenuTrigger` + `HeaderMenuContent`. */
export function ContainerNodeHeaderMenuDropdown(
  props: ComponentProps<typeof DropdownMenu>
) {
  return <DropdownMenu {...props} />;
}

/** Kebab trigger for `HeaderMenuDropdown`. */
export function ContainerNodeHeaderMenuTrigger({
  className,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuTrigger>, "render">) {
  return (
    <DropdownMenuTrigger
      render={
        <Button
          aria-label="Open menu"
          className={cn(RF_MENU_SURFACE_CLASS, "size-7 shrink-0", className)}
          onClick={stopCanvasNodeClick}
          size="icon"
          variant="ghost"
        />
      }
      {...props}
    >
      <MoreHorizontal className="size-3.5" />
    </DropdownMenuTrigger>
  );
}

/** Popover surface — defaults match container-node header menus. */
export function ContainerNodeHeaderMenuContent({
  className,
  ...props
}: ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      align="start"
      className={cn(RF_MENU_SURFACE_CLASS, "rounded-xl", className)}
      {...props}
    />
  );
}

const HEADER_MENU_POSITIVE_ICON_HOVER =
  "hover:[&_svg]:text-green-500 focus:[&_svg]:text-green-500 focus-visible:[&_svg]:text-green-500 hover:[&_svg]:opacity-100 focus:[&_svg]:opacity-100";

/** Menu row — forwards to dropdown item with node-typical sizing and optional leading icon. */
export function ContainerNodeHeaderMenuItem({
  accentHover,
  className,
  children,
  icon: Icon,
  onClick,
  ...props
}: ComponentProps<typeof DropdownMenuItem> & {
  /** Start / Restart: icon uses `text-green-500` on hover / focus (label color unchanged). */
  accentHover?: "positive";
  icon?: LucideIcon;
}) {
  return (
    <DropdownMenuItem
      className={cn(
        "rounded-xl text-xs",
        accentHover === "positive" && HEADER_MENU_POSITIVE_ICON_HOVER,
        className
      )}
      onClick={(event) => {
        stopCanvasNodeClick(event);
        onClick?.(event);
      }}
      {...props}
    >
      {Icon == null ? (
        children
      ) : (
        <>
          <Icon aria-hidden className="size-3.5 shrink-0 opacity-80" />
          {children}
        </>
      )}
    </DropdownMenuItem>
  );
}

/** Destructive row item — host opens `DeleteDialog` outside dropdown content. */
export function ContainerNodeHeaderMenuDelete({
  onConfirmDelete,
  onRequestDelete,
}: {
  onConfirmDelete?: () => void;
  onRequestDelete?: () => void;
}) {
  const requestDelete = onRequestDelete ?? onConfirmDelete;

  return (
    <ContainerNodeHeaderMenuItem
      disabled={requestDelete == null}
      icon={Trash2}
      onClick={requestDelete}
      variant="destructive"
    >
      Delete
    </ContainerNodeHeaderMenuItem>
  );
}

ContainerNodeHeaderMenuDropdown.displayName =
  "ContainerNode.HeaderMenuDropdown";
ContainerNodeHeaderMenuTrigger.displayName = "ContainerNode.HeaderMenuTrigger";
ContainerNodeHeaderMenuContent.displayName = "ContainerNode.HeaderMenuContent";
ContainerNodeHeaderMenuItem.displayName = "ContainerNode.HeaderMenuItem";
ContainerNodeHeaderMenuDelete.displayName = "ContainerNode.HeaderMenuDelete";
