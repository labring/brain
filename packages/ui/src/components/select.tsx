"use client";

import {
  Content as SelectPrimitiveContent,
  Group as SelectPrimitiveGroup,
  Icon as SelectPrimitiveIcon,
  Item as SelectPrimitiveItem,
  ItemIndicator as SelectPrimitiveItemIndicator,
  ItemText as SelectPrimitiveItemText,
  Label as SelectPrimitiveLabel,
  Portal as SelectPrimitivePortal,
  Root as SelectPrimitiveRoot,
  ScrollDownButton as SelectPrimitiveScrollDownButton,
  ScrollUpButton as SelectPrimitiveScrollUpButton,
  Separator as SelectPrimitiveSeparator,
  Trigger as SelectPrimitiveTrigger,
  Value as SelectPrimitiveValue,
  Viewport as SelectPrimitiveViewport,
} from "@radix-ui/react-select";
import { cn } from "@workspace/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import React from "react";

const Select = SelectPrimitiveRoot;

const SelectGroup = SelectPrimitiveGroup;

const SelectValue = SelectPrimitiveValue;

const selectTriggerVariants = cva(
  "flex h-10 w-full cursor-pointer items-center justify-between bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
  {
    variants: {
      variant: {
        ghost: "border-none bg-transparent",
        default:
          "border border-input focus:ring-2 focus:ring-ring focus:ring-offset-2",
      },
      corners: {
        rounded: "rounded-md",
        square:
          "rounded-none focus:ring-0 focus:ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:ring-0 data-[state=open]:ring-offset-0",
      },
    },
    defaultVariants: {
      variant: "default",
      corners: "rounded",
    },
  }
);

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitiveTrigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitiveTrigger> &
    VariantProps<typeof selectTriggerVariants> & {
      indicator?: boolean;
    }
>(
  (
    { className, children, indicator = true, variant, corners, ...props },
    ref
  ) => (
    <SelectPrimitiveTrigger
      className={cn(selectTriggerVariants({ corners, variant }), className)}
      ref={ref}
      {...props}
    >
      {children}
      {indicator && (
        <SelectPrimitiveIcon asChild>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </SelectPrimitiveIcon>
      )}
    </SelectPrimitiveTrigger>
  )
);
SelectTrigger.displayName = SelectPrimitiveTrigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitiveScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitiveScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitiveScrollUpButton
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    ref={ref}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitiveScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitiveScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitiveScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitiveScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitiveScrollDownButton
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className
    )}
    ref={ref}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitiveScrollDownButton>
));
SelectScrollDownButton.displayName =
  SelectPrimitiveScrollDownButton.displayName;

const selectContentCorners = {
  rounded: "rounded-md",
  square: "rounded-none",
} as const;

type SelectContentCorners = keyof typeof selectContentCorners;

const SelectContentCornersContext =
  React.createContext<SelectContentCorners>("rounded");

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitiveContent>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitiveContent> & {
    corners?: SelectContentCorners;
  }
>(
  (
    { className, children, corners = "rounded", position = "popper", ...props },
    ref
  ) => (
    <SelectPrimitivePortal>
      <SelectPrimitiveContent
        className={cn(
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 relative z-50 max-h-96 min-w-32 overflow-hidden border bg-popover text-popover-foreground shadow-md data-[state=closed]:animate-out data-[state=open]:animate-in",
          selectContentCorners[corners],
          position === "popper" &&
            "data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        ref={ref}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitiveViewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)"
          )}
        >
          <SelectContentCornersContext.Provider value={corners}>
            {children}
          </SelectContentCornersContext.Provider>
        </SelectPrimitiveViewport>
        <SelectScrollDownButton />
      </SelectPrimitiveContent>
    </SelectPrimitivePortal>
  )
);
SelectContent.displayName = SelectPrimitiveContent.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitiveLabel>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitiveLabel>
>(({ className, ...props }, ref) => (
  <SelectPrimitiveLabel
    className={cn("py-1.5 pr-2 pl-8 font-semibold text-sm", className)}
    ref={ref}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitiveLabel.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitiveItem>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitiveItem>
>(({ className, children, ...props }, ref) => {
  const contentCorners = React.useContext(SelectContentCornersContext);

  return (
    <SelectPrimitiveItem
      className={cn(
        "relative flex w-full select-none items-center py-1.5 pr-2 pl-8 text-sm outline-hidden focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50",
        contentCorners === "square"
          ? "rounded-none ring-0 focus:ring-0 focus-visible:ring-0 data-highlighted:ring-0"
          : "rounded-sm",
        className,
        "cursor-pointer"
      )}
      ref={ref}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitiveItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitiveItemIndicator>
      </span>

      <SelectPrimitiveItemText>{children}</SelectPrimitiveItemText>
    </SelectPrimitiveItem>
  );
});
SelectItem.displayName = SelectPrimitiveItem.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitiveSeparator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitiveSeparator>
>(({ className, ...props }, ref) => (
  <SelectPrimitiveSeparator
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    ref={ref}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitiveSeparator.displayName;

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  selectTriggerVariants,
};
