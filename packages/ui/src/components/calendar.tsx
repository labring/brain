"use client";

import { type Button, buttonVariants } from "@workspace/ui/components/button";
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
        // Selection backgrounds are painted ONLY by the day buttons (they tile
        // edge-to-edge, so the band is seamless). The cells stay unpainted —
        // a second paint layer under translucent buttons darkens the band and
        // leaks square corners outside the row-edge button radius.
        range_start: cn(defaultClassNames.range_start),
        range_middle: cn(defaultClassNames.range_middle),
        range_end: cn(defaultClassNames.range_end),
        // Today: a faint pill ONLY while unselected. Inside a range (or as an
        // endpoint) the cell renders exactly like its neighbors.
        today: cn(
          "rounded-(--cell-radius) not-data-[selected=true]:bg-input/30",
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
    <button
      className={cn(
        // Plain <button> on purpose: the shared Button's ghost variant ships
        // its own hover / dark-hover backgrounds, which tie with the selected
        // -state rules below at equal specificity and repaint hovered cells.
        // Owning every class here keeps the cascade flat and deterministic.
        //
        // Geometry: fixed-height row cell that stretches to fill the column
        // width (flat non-square cells per the design system).
        "relative isolate z-10 flex h-(--cell-size) w-full min-w-(--cell-size) cursor-pointer select-none flex-col items-center justify-center gap-1 whitespace-nowrap rounded-(--cell-radius) font-normal text-foreground text-xs leading-none outline-none transition-all disabled:pointer-events-none disabled:opacity-50",
        // Hover is deliberately restrained: only UNSELECTED days get a faint
        // input wash. Selected cells (band + endpoints + single) are excluded
        // from the selector itself, so hovering them changes nothing and no
        // rule ever competes with their background.
        "not-data-[range-end=true]:not-data-[range-middle=true]:not-data-[range-start=true]:not-data-[selected-single=true]:hover:bg-input/30",
        // Range middle: square band segment.
        "data-[range-middle=true]:rounded-none data-[range-middle=true]:bg-input",
        // Range endpoints: blue pills that round only their outer edge and
        // flatten the inner edge, but ONLY when they are a *pure* endpoint —
        // a single-day range is both start and end, so it stays fully rounded.
        "data-[range-start=true]:not-data-[range-end=true]:rounded-r-none data-[range-start=true]:rounded-l-(--cell-radius) data-[range-start=true]:bg-blue-500",
        "data-[range-end=true]:rounded-r-(--cell-radius) data-[range-end=true]:not-data-[range-start=true]:rounded-l-none data-[range-end=true]:bg-blue-500",
        // Single selected day (mode="single").
        "data-[selected-single=true]:bg-blue-500",
        // Focus ring for KEYBOARD navigation only (focus-visible) — RDP marks
        // mouse-clicked days as focused too, which used to leave a stray halo
        // around the last-clicked endpoint. z-20 lifts the ring above the
        // neighboring cells so the band never clips it.
        "focus-visible:z-20 focus-visible:ring-[2px] focus-visible:ring-blue-400/50",
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
      ref={ref}
      type="button"
      {...props}
    />
  );
}

export { Calendar, CalendarDayButton };
