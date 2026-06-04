"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";

export interface SingleSelectOption {
  disabled?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  value: string;
}

export interface SingleSelectProps {
  "aria-label"?: string;
  className?: string;
  contentClassName?: string;
  defaultValue?: string;
  disabled?: boolean;
  emptyMessage?: ReactNode;
  onValueChange?: (value: string) => void;
  options: readonly SingleSelectOption[];
  placeholder?: ReactNode;
  triggerClassName?: string;
  value?: string;
}

const singleSelectOpenListeners = new Set<(openId: string) => void>();

function SingleSelectOptionIcon({ children }: { children: ReactNode }) {
  return (
    <span
      className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0"
      data-slot="single-select-option-icon"
    >
      {children}
    </span>
  );
}

function SingleSelectOptionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 truncate" data-slot="single-select-option-label">
      {children}
    </span>
  );
}

function SingleSelectTriggerValue({
  option,
  placeholder,
}: {
  option: SingleSelectOption | undefined;
  placeholder: ReactNode;
}) {
  if (!option) {
    return (
      <span className="min-w-0 truncate text-muted-foreground">
        {placeholder}
      </span>
    );
  }

  return (
    <span
      className="!flex min-w-0 items-center gap-2"
      data-slot="single-select-trigger-value"
    >
      {option.icon ? (
        <SingleSelectOptionIcon>{option.icon}</SingleSelectOptionIcon>
      ) : null}
      <SingleSelectOptionLabel>{option.label}</SingleSelectOptionLabel>
    </span>
  );
}

export function SingleSelect({
  "aria-label": ariaLabel,
  className,
  contentClassName,
  defaultValue,
  disabled = false,
  emptyMessage = "No options available.",
  onValueChange,
  options,
  placeholder = "Select an option",
  triggerClassName,
  value,
}: SingleSelectProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : uncontrolledValue;
  const selectedOption = options.find(
    (option) => option.value === currentValue
  );
  const handleValueChange = useCallback(
    (nextValue: string) => {
      if (!isControlled) {
        setUncontrolledValue(nextValue);
      }
      onValueChange?.(nextValue);
    },
    [isControlled, onValueChange]
  );
  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        for (const listener of singleSelectOpenListeners) {
          listener(id);
        }
      }
    },
    [id]
  );

  useEffect(() => {
    const listener = (openId: string) => {
      if (openId !== id) {
        setOpen(false);
      }
    };
    singleSelectOpenListeners.add(listener);
    return () => {
      singleSelectOpenListeners.delete(listener);
    };
  }, [id]);

  if (options.length === 0) {
    return (
      <div
        className={cn(
          "flex h-9 min-w-0 items-center rounded-md border border-input bg-transparent px-2.5 py-1 text-muted-foreground text-sm leading-5 dark:bg-transparent",
          className
        )}
        data-slot="single-select-empty"
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <Select
      disabled={disabled}
      onOpenChange={handleOpenChange}
      onValueChange={handleValueChange}
      open={open}
      value={currentValue}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={cn(
          "h-9 border-input bg-transparent px-2.5 py-1 text-foreground text-sm placeholder:text-muted-foreground dark:bg-transparent",
          "focus:ring-0 focus:ring-offset-0 focus-visible:border-blue-400 focus-visible:ring-[1px] focus-visible:ring-blue-400/50",
          "data-[state=open]:border-blue-400 data-[state=open]:ring-[1px] data-[state=open]:ring-blue-400/50 data-[state=open]:ring-offset-0",
          className,
          triggerClassName
        )}
      >
        <SelectValue asChild placeholder={placeholder}>
          <SingleSelectTriggerValue
            option={selectedOption}
            placeholder={placeholder}
          />
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        className={cn(
          "border-border bg-input/30 shadow-none backdrop-blur-xl",
          contentClassName
        )}
      >
        {options.map((option) => (
          <SelectItem
            className="pl-2 focus:bg-input/30 data-[highlighted]:bg-input/30 data-[state=checked]:bg-input"
            disabled={option.disabled}
            indicator={false}
            key={option.value}
            textValue={
              typeof option.label === "string" ? option.label : option.value
            }
            value={option.value}
          >
            <span className="flex min-w-0 items-center gap-2">
              {option.icon ? (
                <SingleSelectOptionIcon>{option.icon}</SingleSelectOptionIcon>
              ) : null}
              <SingleSelectOptionLabel>{option.label}</SingleSelectOptionLabel>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
