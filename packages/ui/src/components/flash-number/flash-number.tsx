"use client";

import NumberFlow from "@number-flow/react";
import { cn } from "@workspace/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import { motion } from "motion/react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

const MotionNumberFlow = motion.create(NumberFlow);

/** Maps 0–100% usage to Tailwind text color classes. */
export function usagePercentToneClass(value: number): string {
  if (!Number.isFinite(value)) {
    return "text-zinc-400";
  }
  if (value > 90) {
    return "text-red-500";
  }
  if (value >= 75) {
    return "text-amber-500";
  }
  return "text-green-500";
}

/** Flash highlight behind digits; same thresholds as {@link usagePercentToneClass}. */
export function usagePercentFlashBgClass(value: number): string {
  if (!Number.isFinite(value)) {
    return "bg-zinc-400/40";
  }
  if (value > 90) {
    return "bg-red-500/50";
  }
  if (value >= 75) {
    return "bg-amber-500/50";
  }
  return "bg-green-500/50";
}

export interface FlashNumberProps {
  className?: string;
  /** Resource icon (e.g. `Cpu`, `MemoryStick`, `HardDrive`); tinted with the same usage tone as digits. */
  icon: LucideIcon;
  /** Maximum fractional digits (e.g. 1 → one decimal in the percent). */
  maxDecimals?: number;
  /** Percentage on a 0–100 scale (e.g. `42.5` → `42.5%`). */
  value: number;
}

/**
 * Animated percentage readout with [NumberFlow](https://number-flow.barvian.me) +
 * [Motion](https://motion.dev) for the flash tint only. Digits use usage tone (**&lt; 75%** green,
 * **75–90%** amber, **&gt; 90%** red); icon uses the same tone.
 * Icon and wrapper are static (no Motion `layout`) so first paint does not run layout FLIP from a
 * wrong box when fonts or NumberFlow width settle.
 * On value change, a tinted highlight (green/amber/red at `/50`, same bands as digits)
 * behind the numbers fades out quickly.
 */
export function FlashNumber({
  value,
  maxDecimals = 1,
  className,
  icon: Icon,
}: FlashNumberProps) {
  const [flashKey, setFlashKey] = useState(0);
  const prevValue = useRef<number | null>(null);

  useEffect(() => {
    if (prevValue.current === null) {
      prevValue.current = value;
      return;
    }
    if (prevValue.current === value) {
      return;
    }
    prevValue.current = value;
    setFlashKey((k) => k + 1);
  }, [value]);

  const ratio = Number.isFinite(value) ? value / 100 : 0;
  const toneClass = usagePercentToneClass(value);
  const flashBgClass = usagePercentFlashBgClass(value);

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <Icon
        aria-hidden
        className={cn(
          "size-3 shrink-0 transition-colors duration-200",
          toneClass
        )}
        strokeWidth={2}
      />
      <span className="relative inline-grid min-w-0">
        {flashKey > 0 ? (
          <motion.span
            animate={{ opacity: 0 }}
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 rounded-sm",
              flashBgClass
            )}
            initial={{ opacity: 1 }}
            key={flashKey}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />
        ) : null}
        <MotionNumberFlow
          className={cn(
            "relative z-1 font-mono tabular-nums transition-colors duration-200",
            toneClass
          )}
          format={{
            maximumFractionDigits: maxDecimals,
            style: "percent",
          }}
          style={
            {
              "--number-flow-mask-height": "0.3em",
            } as CSSProperties
          }
          value={ratio}
        />
      </span>
    </span>
  );
}
