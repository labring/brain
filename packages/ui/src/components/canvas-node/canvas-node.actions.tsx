"use client";

import {
  AppIconButton,
  type AppIconButtonProps,
} from "@workspace/ui/components/app-icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { Ellipsis } from "lucide-react";
import type { ComponentProps, ReactNode, SyntheticEvent } from "react";

const RF_CONTROL_CLASS = "nodrag nopan";
const CANVAS_NODE_MENU_ALIGN_OFFSET = -10;
const CANVAS_NODE_MENU_SIDE_OFFSET = 14;

export type CanvasNodeActionTone =
  | "default"
  | "destructive"
  | "info"
  | "muted"
  | "success";

export interface CanvasNodeAction {
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  onClick?: () => Promise<void> | void;
}

export function stopCanvasNodeControlEvent(event: SyntheticEvent) {
  event.stopPropagation();
}

export function invokeCanvasNodeAction(action: CanvasNodeAction | undefined) {
  if (!action?.onClick || action.disabled || action.loading) {
    return;
  }

  Promise.resolve(action.onClick()).catch(() => undefined);
}

export function CanvasNodeActionBar({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "canvas-node-action-bar mt-2 flex min-w-0 items-center justify-end gap-1",
        className
      )}
      data-slot="canvas-node-action-bar"
      {...props}
    />
  );
}

export interface CanvasNodeActionButtonProps {
  action?: CanvasNodeAction;
  "aria-label": string;
  children?: ReactNode;
  className?: string;
  title?: string;
}

export function CanvasNodeActionButton({
  action,
  "aria-label": ariaLabel,
  children,
  className,
  title,
}: CanvasNodeActionButtonProps) {
  const disabled = action?.disabled || action?.loading || !action?.onClick;
  const disabledReason = disabled ? action?.disabledReason : undefined;
  const tooltip = disabledReason ?? title ?? ariaLabel;
  const button = (
    <AppIconButton
      aria-description={disabledReason}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      className={cn(
        RF_CONTROL_CLASS,
        "canvas-node-action-button shrink-0 cursor-pointer border-0",
        disabledReason && "cursor-not-allowed opacity-50",
        className
      )}
      disabled={disabled && disabledReason == null}
      onClick={(event) => {
        event.stopPropagation();
        invokeCanvasNodeAction(action);
      }}
      onDoubleClick={stopCanvasNodeControlEvent}
      onKeyDown={stopCanvasNodeControlEvent}
      onPointerDown={stopCanvasNodeControlEvent}
      size="md"
      title={disabledReason}
      type="button"
      variant="node"
    >
      {action?.loading ? <Spinner className="size-4" /> : children}
    </AppIconButton>
  );

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export interface CanvasNodeActionMenuProps {
  align?: ComponentProps<typeof DropdownMenuContent>["align"];
  alignOffset?: ComponentProps<typeof DropdownMenuContent>["alignOffset"];
  "aria-label": string;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
  side?: ComponentProps<typeof DropdownMenuContent>["side"];
  sideOffset?: ComponentProps<typeof DropdownMenuContent>["sideOffset"];
  triggerSize?: AppIconButtonProps["size"];
  triggerVariant?: AppIconButtonProps["variant"];
}

export function CanvasNodeActionMenu({
  align = "start",
  alignOffset = CANVAS_NODE_MENU_ALIGN_OFFSET,
  "aria-label": ariaLabel,
  children,
  className,
  contentClassName,
  side = "right",
  sideOffset = CANVAS_NODE_MENU_SIDE_OFFSET,
  triggerSize = "md",
  triggerVariant = "node",
}: CanvasNodeActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <AppIconButton
            aria-label={ariaLabel}
            className={cn(
              RF_CONTROL_CLASS,
              "canvas-node-action-menu-trigger shrink-0 cursor-pointer border-0",
              className
            )}
            onClick={stopCanvasNodeControlEvent}
            size={triggerSize}
            type="button"
            variant={triggerVariant}
          >
            <Ellipsis aria-hidden className="size-4" />
          </AppIconButton>
        }
      />
      <DropdownMenuContent
        align={align}
        alignOffset={alignOffset}
        className={cn(
          RF_CONTROL_CLASS,
          "canvas-node-action-menu-content w-38 min-w-38 rounded-md border-0 bg-white/5 p-1 text-zinc-50 shadow-none ring-1 ring-white/10 ring-inset",
          contentClassName
        )}
        side={side}
        sideOffset={sideOffset}
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export interface CanvasNodeActionMenuItemProps {
  action?: CanvasNodeAction;
  actionKey?: string;
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
  tone?: CanvasNodeActionTone;
}

export function CanvasNodeActionMenuItem({
  action,
  actionKey,
  children,
  className,
  icon,
  tone = "default",
}: CanvasNodeActionMenuItemProps) {
  const disabled = action?.disabled || action?.loading || !action?.onClick;
  const disabledReason = disabled ? action?.disabledReason : undefined;

  const item = (
    <DropdownMenuItem
      className={cn(
        "canvas-node-action-menu-item h-7 cursor-pointer rounded-md px-2 py-0 font-normal text-sm text-zinc-200 leading-none hover:bg-white/15 hover:text-zinc-50 focus:bg-white/15 focus:text-zinc-50",
        disabledReason &&
          "cursor-not-allowed data-disabled:pointer-events-auto",
        className
      )}
      data-action-key={actionKey}
      data-tone={tone === "default" ? undefined : tone}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        invokeCanvasNodeAction(action);
      }}
      title={disabledReason}
    >
      {action?.loading ? <Spinner className="size-4" /> : icon}
      {children}
    </DropdownMenuItem>
  );

  if (!disabledReason) {
    return item;
  }

  return (
    <Tooltip>
      <TooltipTrigger render={item} />
      <TooltipContent side="right">{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
