"use client";

import { Combobox } from "@base-ui/react";
import { popoverSurfaceClass } from "@workspace/ui/lib/popover-surface";
import { cn } from "@workspace/ui/lib/utils";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface AppSelectOption {
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  /** String used for search matching / display when `label` is not a string. */
  textValue?: string;
  value: string;
}

function optionText(option: AppSelectOption): string {
  if (option.textValue) {
    return option.textValue;
  }
  if (typeof option.label === "string") {
    return option.label;
  }
  return option.value;
}

const triggerClass = cn(
  "group flex h-9 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-foreground text-sm outline-none transition-[color,background-color,box-shadow] hover:bg-input/30 disabled:pointer-events-none disabled:opacity-50",
  "focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50",
  "data-[popup-open]:border-blue-400 data-[popup-open]:ring-[1px] data-[popup-open]:ring-blue-400/50"
);

const itemClass =
  "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-2 text-sm outline-hidden data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-input/30 data-selected:bg-input";

function OptionIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0">
      {children}
    </span>
  );
}

function OptionContent({ option }: { option: AppSelectOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {option.icon ? <OptionIcon>{option.icon}</OptionIcon> : null}
      <span className="min-w-0 truncate">{option.label}</span>
    </span>
  );
}

function TriggerChevron() {
  return (
    <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground opacity-50 transition-transform duration-200 group-data-[popup-open]:rotate-180" />
  );
}

function SelectPopup({
  children,
  className,
  emptyMessage,
  header,
  minWidthClassName,
  searchPlaceholder,
  searchable,
}: {
  children: ReactNode | ((item: string, index: number) => ReactNode);
  className?: string;
  emptyMessage: ReactNode;
  header?: ReactNode;
  minWidthClassName?: string;
  searchPlaceholder: string;
  searchable: boolean;
}) {
  return (
    <Combobox.Portal>
      <Combobox.Positioner
        align="start"
        className="isolate z-50"
        sideOffset={6}
      >
        <Combobox.Popup
          className={cn(
            popoverSurfaceClass,
            "max-h-72 w-(--anchor-width) origin-(--transform-origin) overflow-hidden p-0",
            minWidthClassName,
            className
          )}
          initialFocus={searchable ? false : undefined}
        >
          {searchable ? (
            <div className="relative flex h-9 items-center border-border border-b px-3 transition-colors focus-within:border-blue-400">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
              />
              <Combobox.Input
                className="h-full min-w-0 flex-1 bg-transparent pl-6 text-foreground text-sm outline-none placeholder:text-muted-foreground"
                placeholder={searchPlaceholder}
              />
            </div>
          ) : null}
          {header}
          <Combobox.List className="max-h-72 overflow-y-auto p-1">
            {children}
          </Combobox.List>
          <Combobox.Empty>
            <div className="px-2 py-6 text-center text-muted-foreground text-sm">
              {emptyMessage}
            </div>
          </Combobox.Empty>
        </Combobox.Popup>
      </Combobox.Positioner>
    </Combobox.Portal>
  );
}

export interface AppSelectProps {
  "aria-label"?: string;
  className?: string;
  contentClassName?: string;
  "data-testid"?: string;
  defaultValue?: string;
  disabled?: boolean;
  emptyMessage?: ReactNode;
  id?: string;
  onValueChange?: (value: string) => void;
  options: readonly AppSelectOption[];
  placeholder?: ReactNode;
  /** Show an in-popup search input. @default false */
  searchable?: boolean;
  searchPlaceholder?: string;
  triggerClassName?: string;
  value?: string;
}

export function AppSelect({
  "aria-label": ariaLabel,
  className,
  contentClassName,
  "data-testid": dataTestId,
  defaultValue,
  disabled = false,
  emptyMessage = "No options available.",
  id,
  onValueChange,
  options,
  placeholder = "Select an option",
  searchPlaceholder = "Search",
  searchable = false,
  triggerClassName,
  value,
}: AppSelectProps) {
  const byValue = new Map(options.map((option) => [option.value, option]));
  const filter = searchable ? undefined : null;

  if (options.length === 0) {
    return (
      <div
        className={cn(
          "flex h-9 min-w-0 items-center rounded-md border border-input bg-transparent px-2.5 py-1 text-muted-foreground text-sm leading-5 dark:bg-transparent",
          className
        )}
        data-slot="app-select-empty"
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <Combobox.Root
      defaultValue={defaultValue}
      disabled={disabled}
      filter={filter}
      items={options.map((option) => option.value)}
      itemToStringLabel={(itemValue: string) => {
        const option = byValue.get(itemValue);
        return option ? optionText(option) : itemValue;
      }}
      onValueChange={(next) => {
        if (typeof next === "string") {
          onValueChange?.(next);
        }
      }}
      value={value ?? null}
    >
      <Combobox.Trigger
        aria-label={ariaLabel}
        className={cn(triggerClass, className, triggerClassName)}
        data-slot="app-select-trigger"
        data-testid={dataTestId}
        id={id}
      >
        <Combobox.Value>
          {(selected: string | null) => {
            const option = selected ? byValue.get(selected) : undefined;
            if (!option) {
              return (
                <span className="min-w-0 truncate text-muted-foreground">
                  {placeholder}
                </span>
              );
            }
            return <OptionContent option={option} />;
          }}
        </Combobox.Value>
        <TriggerChevron />
      </Combobox.Trigger>
      <SelectPopup
        className={contentClassName}
        emptyMessage={emptyMessage}
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
      >
        {(itemValue: string) => {
          const option = byValue.get(itemValue);
          if (!option) {
            return null;
          }
          return (
            <Combobox.Item
              className={itemClass}
              disabled={option.disabled}
              key={itemValue}
              value={itemValue}
            >
              <OptionContent option={option} />
            </Combobox.Item>
          );
        }}
      </SelectPopup>
    </Combobox.Root>
  );
}

export interface AppMultiSelectOption extends AppSelectOption {}

export interface AppMultiSelectProps {
  allLabel?: ReactNode;
  "aria-label"?: string;
  className?: string;
  contentClassName?: string;
  "data-testid"?: string;
  disabled?: boolean;
  emptyMessage?: ReactNode;
  /** Trigger icon shown regardless of selection. */
  icon?: ReactNode;
  onValueChange?: (value: string[]) => void;
  options: readonly AppMultiSelectOption[];
  placeholder?: ReactNode;
  /** Show an in-popup search input. @default true */
  searchable?: boolean;
  searchPlaceholder?: string;
  triggerClassName?: string;
  value: readonly string[];
}

function MultiCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-input text-blue-400"
      data-slot="app-multi-select-checkbox"
    >
      <CheckIcon className={cn("size-4", !checked && "opacity-0")} />
    </span>
  );
}

export function AppMultiSelect({
  allLabel = "All",
  "aria-label": ariaLabel,
  className,
  contentClassName,
  "data-testid": dataTestId,
  disabled = false,
  emptyMessage = "No options available.",
  icon,
  onValueChange,
  options,
  placeholder = "Select options",
  searchPlaceholder = "Search",
  searchable = true,
  triggerClassName,
  value,
}: AppMultiSelectProps) {
  const byValue = new Map(options.map((option) => [option.value, option]));
  const selectedValues = value.filter((item) => byValue.has(item));
  const filter = searchable ? undefined : null;

  if (options.length === 0) {
    return (
      <div
        className={cn(
          "flex h-9 min-w-0 items-center rounded-md border border-input bg-transparent px-2.5 py-1 text-muted-foreground text-sm leading-5 dark:bg-transparent",
          className
        )}
        data-slot="app-multi-select-empty"
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <Combobox.Root
      disabled={disabled}
      filter={filter}
      items={options.map((option) => option.value)}
      itemToStringLabel={(itemValue: string) => {
        const option = byValue.get(itemValue);
        return option ? optionText(option) : itemValue;
      }}
      multiple
      onValueChange={(next: string[]) => onValueChange?.(next)}
      value={selectedValues}
    >
      <Combobox.Trigger
        aria-label={ariaLabel}
        className={cn(triggerClass, className, triggerClassName)}
        data-slot="app-multi-select-trigger"
        data-testid={dataTestId}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {icon ? <OptionIcon>{icon}</OptionIcon> : null}
          <Combobox.Value>
            {(selected: string[]) => {
              const count = Array.isArray(selected) ? selected.length : 0;
              if (count === 0) {
                return (
                  <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
                    {placeholder}
                  </span>
                );
              }
              if (count === 1) {
                const option = byValue.get(selected[0] as string);
                return (
                  <span className="min-w-0 flex-1 truncate text-left">
                    {option ? option.label : selected[0]}
                  </span>
                );
              }
              return (
                <span className="min-w-0 flex-1 truncate text-left">
                  {count} selected
                </span>
              );
            }}
          </Combobox.Value>
        </span>
        <TriggerChevron />
      </Combobox.Trigger>
      <SelectPopup
        className={contentClassName}
        emptyMessage={emptyMessage}
        header={
          <div className="p-1 pb-0">
            <button
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-2 text-left text-sm outline-none hover:bg-input/30"
              onClick={() => onValueChange?.([])}
              type="button"
            >
              <MultiCheckbox checked={selectedValues.length === 0} />
              <span className="min-w-0 truncate">{allLabel}</span>
            </button>
          </div>
        }
        minWidthClassName="min-w-60"
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
      >
        {(itemValue: string) => {
          const option = byValue.get(itemValue);
          if (!option) {
            return null;
          }
          const checked = selectedValues.includes(itemValue);
          return (
            <Combobox.Item
              className={itemClass}
              disabled={option.disabled}
              key={itemValue}
              value={itemValue}
            >
              <MultiCheckbox checked={checked} />
              <OptionContent option={option} />
            </Combobox.Item>
          );
        }}
      </SelectPopup>
    </Combobox.Root>
  );
}
