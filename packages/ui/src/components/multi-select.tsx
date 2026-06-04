"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { Check, ChevronDown, Search } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";

export interface MultiSelectOption {
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  textValue?: string;
  value: string;
}

export interface MultiSelectProps {
  allLabel?: ReactNode;
  "aria-label"?: string;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  emptyMessage?: ReactNode;
  icon?: ReactNode;
  onValueChange?: (value: string[]) => void;
  options: readonly MultiSelectOption[];
  placeholder?: ReactNode;
  searchPlaceholder?: string;
  triggerClassName?: string;
  value: readonly string[];
}

const multiSelectOpenListeners = new Set<(openId: string) => void>();

function MultiSelectOptionIcon({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0"
      data-slot="multi-select-option-icon"
    >
      {children}
    </span>
  );
}

function MultiSelectOptionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 truncate" data-slot="multi-select-option-label">
      {children}
    </span>
  );
}

function MultiSelectCheckbox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-input text-blue-400"
      data-checked={checked}
      data-slot="multi-select-checkbox"
    >
      <Check className={cn("size-4", !checked && "opacity-0")} />
    </span>
  );
}

function optionText(option: MultiSelectOption) {
  if (option.textValue) {
    return option.textValue;
  }
  if (typeof option.label === "string") {
    return option.label;
  }
  return option.value;
}

function MultiSelectTriggerValue({
  icon,
  options,
  placeholder,
  value,
}: {
  icon?: ReactNode;
  options: readonly MultiSelectOption[];
  placeholder: ReactNode;
  value: readonly string[];
}) {
  const selectedOptions = options.filter((option) =>
    value.includes(option.value)
  );
  const selectedOption = selectedOptions[0];
  const triggerIcon =
    icon ?? (value.length === 1 ? selectedOption?.icon : undefined);
  const isAll = value.length === 0;

  let label = placeholder;
  if (value.length === 1 && selectedOption) {
    label = selectedOption.label;
  } else if (value.length > 1) {
    label = `${value.length} selected`;
  }

  return (
    <span
      className="!flex min-w-0 flex-1 items-center gap-2"
      data-slot="multi-select-trigger-value"
    >
      {triggerIcon ? (
        <MultiSelectOptionIcon>{triggerIcon}</MultiSelectOptionIcon>
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left",
          isAll && "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </span>
  );
}

export function MultiSelect({
  "aria-label": ariaLabel,
  allLabel = "All",
  className,
  contentClassName,
  disabled = false,
  emptyMessage = "No options available.",
  icon,
  onValueChange,
  options,
  placeholder = "Select options",
  searchPlaceholder = "Search",
  triggerClassName,
  value,
}: MultiSelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedValues = useMemo(() => new Set(value), [value]);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) =>
      optionText(option).toLowerCase().includes(normalizedQuery)
    );
  }, [options, query]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        for (const listener of multiSelectOpenListeners) {
          listener(id);
        }
      } else {
        setQuery("");
      }
    },
    [id]
  );

  const handleClear = useCallback(() => {
    onValueChange?.([]);
  }, [onValueChange]);

  const handleToggle = useCallback(
    (option: MultiSelectOption) => {
      if (option.disabled) {
        return;
      }
      const next = selectedValues.has(option.value)
        ? value.filter((item) => item !== option.value)
        : [...value, option.value];
      onValueChange?.(next);
    },
    [onValueChange, selectedValues, value]
  );

  useEffect(() => {
    const listener = (openId: string) => {
      if (openId !== id) {
        setOpen(false);
        setQuery("");
      }
    };
    multiSelectOpenListeners.add(listener);
    return () => {
      multiSelectOpenListeners.delete(listener);
    };
  }, [id]);

  if (options.length === 0) {
    return (
      <div
        className={cn(
          "flex h-9 min-w-0 items-center rounded-md border border-input bg-transparent px-2.5 py-1 text-muted-foreground text-sm leading-5 dark:bg-transparent",
          className
        )}
        data-slot="multi-select-empty"
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <PopoverTrigger
        aria-label={ariaLabel}
        className={cn(
          "flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-foreground text-sm outline-none transition-[color,box-shadow] hover:bg-input/30 disabled:pointer-events-none disabled:opacity-50 dark:bg-transparent",
          "focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50",
          open && "border-blue-400 ring-[1px] ring-blue-400/50 ring-offset-0",
          className,
          triggerClassName
        )}
        disabled={disabled}
        type="button"
      >
        <MultiSelectTriggerValue
          icon={icon}
          options={options}
          placeholder={placeholder}
          value={value}
        />
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn(
          "w-[var(--anchor-width)] min-w-60 gap-0 rounded-md border border-border bg-input/30 p-0 shadow-none ring-0 backdrop-blur-xl",
          contentClassName
        )}
      >
        <div
          className="relative flex h-10 items-center border-border border-b px-3"
          data-slot="multi-select-search"
        >
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
          />
          <input
            aria-label={
              typeof searchPlaceholder === "string"
                ? searchPlaceholder
                : undefined
            }
            className="h-full min-w-0 flex-1 bg-transparent pl-6 font-medium text-muted-foreground text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            type="search"
            value={query}
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1" role="listbox">
          <button
            aria-pressed={value.length === 0}
            className={cn(
              "flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-input focus-visible:bg-input",
              value.length === 0 && "rounded-md bg-input"
            )}
            data-slot="multi-select-item"
            onClick={handleClear}
            type="button"
          >
            <MultiSelectCheckbox checked={value.length === 0} />
            <MultiSelectOptionLabel>{allLabel}</MultiSelectOptionLabel>
          </button>
          {filteredOptions.length === 0 ? (
            <div
              className="px-2 py-6 text-center text-muted-foreground text-sm"
              data-slot="multi-select-no-results"
            >
              {emptyMessage}
            </div>
          ) : (
            filteredOptions.map((option) => {
              const checked = selectedValues.has(option.value);
              return (
                <button
                  aria-pressed={checked}
                  className={cn(
                    "flex h-8 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-input focus-visible:bg-input disabled:pointer-events-none disabled:opacity-50",
                    checked && "rounded-md bg-input"
                  )}
                  data-slot="multi-select-item"
                  disabled={option.disabled}
                  key={option.value}
                  onClick={() => handleToggle(option)}
                  type="button"
                >
                  <MultiSelectCheckbox checked={checked} />
                  {option.icon ? (
                    <MultiSelectOptionIcon>{option.icon}</MultiSelectOptionIcon>
                  ) : null}
                  <MultiSelectOptionLabel>
                    {option.label}
                  </MultiSelectOptionLabel>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
