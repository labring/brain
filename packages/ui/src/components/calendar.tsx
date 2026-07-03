"use client";

import { Button, buttonVariants } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import React from "react";
import {
  type DayButton,
  DayPicker,
  getDefaultClassNames,
} from "react-day-picker";

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = "label",
  buttonVariant = "ghost",
  formatters,
  components,
  ...props
}: React.ComponentProps<typeof DayPicker> & {
  buttonVariant?: React.ComponentProps<typeof Button>["variant"];
}) {
  const defaultClassNames = getDefaultClassNames();

  return (
    <DayPicker
      captionLayout={captionLayout}
      className={cn(
        "group/calendar bg-background p-3 [--cell-radius:var(--radius-md)] [--cell-size:--spacing(8)] [[data-slot=card-content]_&]:bg-transparent [[data-slot=popover-content]_&]:bg-transparent",
        String.raw`rtl:**:[.rdp-button\_next>svg]:rotate-180`,
        String.raw`rtl:**:[.rdp-button\_previous>svg]:rotate-180`,
        className
      )}
      classNames={{
        root: cn("w-fit", defaultClassNames.root),
        months: cn(
          "relative flex flex-col gap-4 md:flex-row",
          defaultClassNames.months
        ),
        month: cn("flex w-full flex-col gap-4", defaultClassNames.month),
        nav: cn(
          "absolute inset-x-0 top-0 flex w-full items-center justify-between gap-1",
          defaultClassNames.nav
        ),
        button_previous: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-7 select-none rounded-md border border-input bg-transparent p-0 text-muted-foreground opacity-50 hover:bg-input/30 hover:text-foreground aria-disabled:opacity-50",
          defaultClassNames.button_previous
        ),
        button_next: cn(
          buttonVariants({ variant: buttonVariant }),
          "size-7 select-none rounded-md border border-input bg-transparent p-0 text-muted-foreground opacity-50 hover:bg-input/30 hover:text-foreground aria-disabled:opacity-50",
          defaultClassNames.button_next
        ),
        month_caption: cn(
          "flex h-(--cell-size) w-full items-center justify-center px-(--cell-size)",
          defaultClassNames.month_caption
        ),
        dropdowns: cn(
          "flex h-(--cell-size) w-full items-center justify-center gap-1.5 font-medium text-sm",
          defaultClassNames.dropdowns
        ),
        dropdown_root: cn(
          "cn-calendar-dropdown-root relative rounded-(--cell-radius)",
          defaultClassNames.dropdown_root
        ),
        dropdown: cn(
          "absolute inset-0 bg-popover opacity-0",
          defaultClassNames.dropdown
        ),
        caption_label: cn(
          "select-none font-medium",
          captionLayout === "label"
            ? "text-sm"
            : "cn-calendar-caption-label flex items-center gap-1 rounded-(--cell-radius) text-sm [&>svg]:size-3.5 [&>svg]:text-muted-foreground",
          defaultClassNames.caption_label
        ),
        table: "w-full border-collapse",
        weekdays: cn("flex", defaultClassNames.weekdays),
        weekday: cn(
          "flex-1 select-none rounded-(--cell-radius) font-normal text-muted-foreground text-xs",
          defaultClassNames.weekday
        ),
        week: cn("mt-2 flex w-full", defaultClassNames.week),
        week_number_header: cn(
          "w-(--cell-size) select-none",
          defaultClassNames.week_number_header
        ),
        week_number: cn(
          "select-none text-[0.8rem] text-muted-foreground",
          defaultClassNames.week_number
        ),
        day: cn(
          "group/day relative h-full w-full select-none rounded-(--cell-radius) p-0 text-center [&:last-child[data-selected=true]_button]:rounded-r-(--cell-radius)",
          props.showWeekNumber
            ? "[&:nth-child(2)[data-selected=true]_button]:rounded-l-(--cell-radius)"
            : "[&:first-child[data-selected=true]_button]:rounded-l-(--cell-radius)",
          defaultClassNames.day
        ),
        range_start: cn(
          "relative isolate -z-0 rounded-l-(--cell-radius) bg-input after:absolute after:inset-y-0 after:right-0 after:w-4 after:bg-input",
          defaultClassNames.range_start
        ),
        range_middle: cn(
          "rounded-none bg-input",
          defaultClassNames.range_middle
        ),
        range_end: cn(
          "relative isolate -z-0 rounded-r-(--cell-radius) bg-input after:absolute after:inset-y-0 after:left-0 after:w-4 after:bg-input",
          defaultClassNames.range_end
        ),
        today: cn(
          "rounded-(--cell-radius) bg-input/30 text-foreground data-[selected=true]:rounded-none",
          defaultClassNames.today
        ),
        outside: cn(
          "text-muted-foreground opacity-50 aria-selected:text-muted-foreground",
          defaultClassNames.outside
        ),
        disabled: cn(
          "text-muted-foreground opacity-50",
          defaultClassNames.disabled
        ),
        hidden: cn("invisible", defaultClassNames.hidden),
        ...classNames,
      }}
      components={{
        Root: ({ className, rootRef, ...props }) => {
          return (
            <div
              className={cn(className)}
              data-slot="calendar"
              ref={rootRef as React.Ref<HTMLDivElement>}
              {...props}
            />
          );
        },
        Chevron: ({ className, orientation, ...props }) => {
          if (orientation === "left") {
            return (
              <ChevronLeftIcon className={cn("size-4", className)} {...props} />
            );
          }

          if (orientation === "right") {
            return (
              <ChevronRightIcon
                className={cn("size-4", className)}
                {...props}
              />
            );
          }

          return (
            <ChevronDownIcon className={cn("size-4", className)} {...props} />
          );
        },
        DayButton: CalendarDayButton,
        WeekNumber: ({ children, ...props }) => {
          return (
            <td {...props}>
              <div className="flex size-(--cell-size) items-center justify-center text-center">
                {children}
              </div>
            </td>
          );
        },
        ...components,
      }}
      formatters={{
        formatMonthDropdown: (date) =>
          date.toLocaleString("default", { month: "short" }),
        ...formatters,
      }}
      showOutsideDays={showOutsideDays}
      {...props}
    />
  );
}

function CalendarDayButton({
  className,
  day,
  modifiers,
  ...props
}: React.ComponentProps<typeof DayButton>) {
  const defaultClassNames = getDefaultClassNames();

  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers.focused) {
      ref.current?.focus();
    }
  }, [modifiers.focused]);

  return (
    <Button
      className={cn(
        // Geometry: fixed-height row cell that stretches to fill the column
        // width (flat non-square cells per the design system), rounded by
        // default so the unselected-hover pill matches.
        "relative isolate z-10 flex h-(--cell-size) w-full min-w-(--cell-size) flex-col gap-1 rounded-(--cell-radius) border-0 font-normal text-foreground leading-none",
        // Unselected hover — bg-input overrides the ghost variant's
        // hover:bg-accent via tailwind-merge (same variant + property).
        "hover:bg-input",
        // Range middle: square band segment; hover lifts one shade to accent.
        "data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-input data-[range-middle=true]:text-foreground data-[range-middle=true]:hover:bg-accent",
        // Range endpoints: blue pills that round only their outer edge and
        // flatten the inner edge, but ONLY when they are a *pure* endpoint —
        // a single-day range is both start and end, so it stays fully rounded.
        "data-[range-start=true]:not-data-[range-end=true]:rounded-r-none data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-blue-500 data-[range-start=true]:text-foreground data-[range-start=true]:hover:bg-blue-500",
        "data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:not-data-[range-start=true]:rounded-l-none data-[range-end=true]:bg-blue-500 data-[range-end=true]:text-foreground data-[range-end=true]:hover:bg-blue-500",
        // Single selected day (mode="single").
        "data-[selected-single=true]:bg-blue-500 data-[selected-single=true]:text-foreground data-[selected-single=true]:hover:bg-blue-500",
        // Keyboard focus ring, matched to the trigger's blue focus treatment.
        "group-data-[focused=true]/day:relative group-data-[focused=true]/day:z-10 group-data-[focused=true]/day:border-blue-400 group-data-[focused=true]/day:ring-[2px] group-data-[focused=true]/day:ring-blue-400/50",
        "[&>span]:text-xs [&>span]:opacity-70",
        defaultClassNames.day,
        className
      )}
      data-day={day.date.toLocaleDateString()}
      data-range-end={modifiers.range_end}
      data-range-middle={modifiers.range_middle}
      data-range-start={modifiers.range_start}
      data-selected-single={
        modifiers.selected &&
        !modifiers.range_start &&
        !modifiers.range_end &&
        !modifiers.range_middle
      }
      size="icon"
      variant="ghost"
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
