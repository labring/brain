"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "@workspace/ui/lib/utils";

function TooltipProvider({
  delay = 420,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  );
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  anchor,
  className,
  side = "bottom",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  arrow = false,
  children,
  positionerClassName,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "anchor" | "side" | "sideOffset"
  > & {
    arrow?: boolean;
    /** Merged into the positioner — the z-index lives there, so tooltips inside dialogs (popup z-[51]) must raise it. */
    positionerClassName?: string;
  }) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className={cn("isolate z-50", positionerClassName)}
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          className={cn(
            "data-open:fade-in-0 data-open:zoom-in-95 data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-closed:fade-out-0 data-closed:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit max-w-xs origin-(--transform-origin) rounded-lg border-border/70 border-t-[0.5px] border-l-[0.5px] bg-input/30 px-2.5 py-2 font-normal text-primary text-xs leading-4 shadow-[0px_2px_4px_0px_rgba(8,10,17,0.25),inset_-1px_-1px_4px_0px_rgba(8,10,17,0.25)] outline-none backdrop-blur-lg [word-break:break-word] data-[state=delayed-open]:animate-in data-closed:animate-out data-open:animate-in",
            className
          )}
          data-slot="tooltip-content"
          {...props}
        >
          {children}
          {arrow && (
            <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] border-border/70 border-t-[0.5px] border-l-[0.5px] bg-input/30 fill-input/30 shadow-[inset_-1px_-1px_4px_0px_rgba(8,10,17,0.25)] data-[side=bottom]:top-1 data-[side=left]:top-1/2! data-[side=right]:top-1/2! data-[side=left]:-right-1 data-[side=top]:-bottom-2.5 data-[side=right]:-left-1 data-[side=left]:-translate-y-1/2 data-[side=right]:-translate-y-1/2" />
          )}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
