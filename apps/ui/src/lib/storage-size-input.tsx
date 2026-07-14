"use client";

import { Input } from "@workspace/ui/components/input";
import { fieldInvalidRingClass } from "@workspace/ui/lib/field-state";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseStorageSizeToGi, storageSizeToCanonical } from "./storage-size";

const DEFAULT_MIN_SIZE = "0.1Gi";
const DEFAULT_MAX_GI = 100;
const STEP_GI = 0.1;

// The bordered wrapper takes the focus ring (via `has-`) since the bare inner
// input has none. Blue values match `appFieldFocusClass` (see field-state.ts —
// wrapper triggers keep their own strings).
const GROUP_FOCUS_CLASS =
  "has-[input:focus-visible]:border-blue-400 has-[input:focus-visible]:ring-[1px] has-[input:focus-visible]:ring-blue-400/50";

function formatGiText(gi: number | null): string {
  return gi === null ? "" : String(gi);
}

export interface StorageSizeInputProps {
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  /** Largest selectable size, in Gi. Defaults to 100. */
  maxGi?: number;
  /**
   * Floor as a quantity string. Create flows pass "0.1Gi"; edit flows pass the
   * current size so a StatefulSet PVC can only grow (expand-only).
   */
  minSize?: string;
  onChange: (nextSize: string) => void;
  readOnly?: boolean;
  /** Stored quantity string, e.g. "1Gi", "512Mi", "107374182400m". */
  value: string;
}

/**
 * A storage-size field: a number input with native steppers and a fixed,
 * non-editable `Gi` suffix inside the field, so the unit is never hand-typed. The
 * stored value stays a canonical Kubernetes quantity string, and a value the user
 * never touches is passed through unchanged (its `onChange` only fires on edit).
 */
export function StorageSizeInput({
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  className,
  disabled,
  id,
  maxGi = DEFAULT_MAX_GI,
  minSize = DEFAULT_MIN_SIZE,
  onChange,
  readOnly,
  value,
}: StorageSizeInputProps) {
  const displayGi = useMemo(() => parseStorageSizeToGi(value), [value]);
  const [text, setText] = useState(() => formatGiText(displayGi));
  const focusedRef = useRef(false);

  // Resync the field from the stored value when it changes externally (e.g. a
  // draft reset), but never while the user is typing.
  useEffect(() => {
    if (!focusedRef.current) {
      setText(formatGiText(displayGi));
    }
  }, [displayGi]);

  const minGi = useMemo(
    () => parseStorageSizeToGi(minSize) ?? STEP_GI,
    [minSize]
  );

  return (
    <div
      className={cn(
        "flex h-9 w-full min-w-0 items-center rounded-md border border-input bg-transparent shadow-xs transition-[color,box-shadow]",
        ariaInvalid ? fieldInvalidRingClass : GROUP_FOCUS_CLASS,
        disabled && "opacity-50",
        className
      )}
    >
      <Input
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        className="h-full min-w-0 flex-1 border-0 bg-transparent px-2.5 shadow-none dark:bg-transparent"
        disabled={disabled}
        id={id}
        inputMode="decimal"
        max={maxGi}
        min={minGi}
        onBlur={() => {
          focusedRef.current = false;
          setText(formatGiText(parseStorageSizeToGi(value)));
        }}
        onChange={(event) => {
          const raw = event.currentTarget.value;
          setText(raw);
          const parsed = Number(raw);
          if (raw.trim() !== "" && Number.isFinite(parsed)) {
            onChange(storageSizeToCanonical(parsed));
          }
        }}
        onFocus={() => {
          focusedRef.current = true;
        }}
        readOnly={readOnly}
        step={STEP_GI}
        type="number"
        value={text}
        variant="bare"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none select-none pr-2.5 pl-1 text-muted-foreground text-sm"
      >
        Gi
      </span>
    </div>
  );
}
