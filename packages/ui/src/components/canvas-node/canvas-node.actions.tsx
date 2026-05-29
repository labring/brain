"use client";

import { Button } from "@workspace/ui/components/button";
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
  TooltipProvider,
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
  const tooltip = title ?? ariaLabel;
  const button = (
    <Button
      aria-label={ariaLabel}
      className={cn(
        RF_CONTROL_CLASS,
        "canvas-node-action-button flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-zinc-950/20 p-0 text-zinc-50 shadow-none transition-colors hover:text-zinc-50",
        className
      )}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        invokeCanvasNodeAction(action);
      }}
      onDoubleClick={stopCanvasNodeControlEvent}
      onKeyDown={stopCanvasNodeControlEvent}
      onPointerDown={stopCanvasNodeControlEvent}
      size={null}
      type="button"
      variant={null}
    >
      {action?.loading ? <Spinner className="size-4" /> : children}
    </Button>
  );

  return (
    <TooltipProvider delay={420}>
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent
          className="canvas-node-action-tooltip rounded-md border-0 bg-white/5 px-2 py-1 font-normal text-xs text-zinc-50 leading-4 shadow-none ring-0 backdrop-blur-xl"
          side="bottom"
          sideOffset={6}
        >
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface CanvasNodeActionMenuProps {
  "aria-label": string;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function CanvasNodeActionMenu({
  "aria-label": ariaLabel,
  children,
  className,
  contentClassName,
}: CanvasNodeActionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={ariaLabel}
            className={cn(
              RF_CONTROL_CLASS,
              "canvas-node-action-menu-trigger flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border-0 bg-zinc-950/20 p-0 text-zinc-50 shadow-none transition-colors hover:text-zinc-50 aria-expanded:bg-white/15 data-popup-open:bg-white/15",
              className
            )}
            onClick={stopCanvasNodeControlEvent}
            size={null}
            type="button"
            variant={null}
          />
        }
      >
        <Ellipsis aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        alignOffset={CANVAS_NODE_MENU_ALIGN_OFFSET}
        className={cn(
          RF_CONTROL_CLASS,
          "canvas-node-action-menu-content w-38 min-w-38 rounded-md border-0 bg-white/5 p-1 text-zinc-50 shadow-none ring-1 ring-white/10 ring-inset",
          contentClassName
        )}
        side="right"
        sideOffset={CANVAS_NODE_MENU_SIDE_OFFSET}
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

  return (
    <DropdownMenuItem
      className={cn(
        "canvas-node-action-menu-item h-7 cursor-pointer rounded-md px-2 py-0 font-normal text-sm text-zinc-200 leading-none hover:bg-white/15 hover:text-zinc-50 focus:bg-white/15 focus:text-zinc-50",
        className
      )}
      data-action-key={actionKey}
      data-tone={tone === "default" ? undefined : tone}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        invokeCanvasNodeAction(action);
      }}
    >
      {action?.loading ? <Spinner className="size-4" /> : icon}
      {children}
    </DropdownMenuItem>
  );
}
