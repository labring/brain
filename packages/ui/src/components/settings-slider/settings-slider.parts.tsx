"use client";

import NumberFlow, { continuous } from "@number-flow/react";
import {
  Range as SliderRange,
  Root as SliderRoot,
  Thumb as SliderThumb,
  Track as SliderTrack,
} from "@radix-ui/react-slider";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentPropsWithoutRef, PointerEvent, ReactNode } from "react";
import { useCallback } from "react";

import { useSettingsSliderContext } from "./settings-slider.context";
import type { SettingsSliderValueAffix } from "./settings-slider.types";

type SliderRootProps = ComponentPropsWithoutRef<typeof SliderRoot>;

type SettingsSliderControlProps = Omit<
  SliderRootProps,
  | "defaultValue"
  | "disabled"
  | "max"
  | "min"
  | "onValueChange"
  | "step"
  | "value"
>;

function resolveValueAffix(
  affix: SettingsSliderValueAffix | undefined,
  value: number
) {
  return typeof affix === "function" ? affix(value) : affix;
}

export function SettingsSliderControl({
  className,
  ...radixRest
}: SettingsSliderControlProps) {
  const {
    setValueFromRadix,
    states: { current, disabled, max, min, step },
  } = useSettingsSliderContext("SettingsSlider.Control");

  const { onPointerUp: userOnPointerUp, ...rootRest } = radixRest;

  const blurFocusedInsideRoot = useCallback((root: HTMLElement) => {
    queueMicrotask(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.contains(active)) {
        active.blur();
      }
    });
  }, []);

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      userOnPointerUp?.(event);
      if (event.pointerType === "mouse") {
        blurFocusedInsideRoot(event.currentTarget);
      }
    },
    [blurFocusedInsideRoot, userOnPointerUp]
  );

  return (
    <SliderRoot
      {...rootRest}
      className={cn(
        "relative flex h-2 w-full min-w-0 touch-none select-none items-center",
        disabled && "opacity-70",
        className
      )}
      disabled={disabled}
      max={max}
      min={min}
      onPointerUp={handlePointerUp}
      onValueChange={setValueFromRadix}
      step={step}
      value={[current]}
    />
  );
}

export function SettingsSliderTrack({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SliderTrack>) {
  return (
    <SliderTrack
      className={cn("relative h-2 grow rounded-full bg-input", className)}
      {...props}
    />
  );
}

export function SettingsSliderRange({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SliderRange>) {
  return (
    <SliderRange
      className={cn(
        "absolute h-full rounded-full bg-gradient-to-r from-blue-950 to-blue-500",
        className
      )}
      {...props}
    />
  );
}

export function SettingsSliderThumb({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof SliderThumb>) {
  return (
    <SliderThumb
      aria-label="Value"
      className={cn(
        "relative block size-4 shrink-0 rounded-full border-2 border-primary bg-blue-500 shadow-none ring-0 hover:cursor-grab focus:cursor-grabbing",
        className
      )}
      {...props}
    >
      {children}
    </SliderThumb>
  );
}

export function SettingsSliderValue({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  const {
    states: {
      displayValue,
      maxDecimals,
      valueFormat,
      valuePrefix,
      valueSuffix,
    },
  } = useSettingsSliderContext("SettingsSlider.Value");

  const resolvedClassName = cn(
    "shrink-0 text-foreground text-sm tabular-nums leading-5",
    className
  );

  if (children !== undefined) {
    return <span className={resolvedClassName}>{children}</span>;
  }

  return (
    <NumberFlow
      className={resolvedClassName}
      format={valueFormat ?? { maximumFractionDigits: maxDecimals }}
      isolate
      locales="en-US"
      opacityTiming={{
        duration: 250,
        easing: "ease-out",
      }}
      plugins={[continuous]}
      prefix={resolveValueAffix(valuePrefix, displayValue)}
      suffix={resolveValueAffix(valueSuffix, displayValue)}
      transformTiming={{
        duration: 500,
        easing:
          "linear(0, 0.0033 0.8%, 0.0263 2.39%, 0.0896 4.77%, 0.4676 15.12%, 0.5688, 0.6553, 0.7274, 0.7862, 0.8336 31.04%, 0.8793, 0.9132 38.99%, 0.9421 43.77%, 0.9642 49.34%, 0.9796 55.71%, 0.9893 62.87%, 0.9952 71.62%, 0.9983 82.76%, 0.9996 99.47%)",
      }}
      value={displayValue}
      willChange
    />
  );
}

export function SettingsSliderBounds({
  className,
  maxLabel,
  minLabel,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  maxLabel?: ReactNode;
  minLabel?: ReactNode;
}) {
  const {
    states: {
      formatBound,
      max,
      maxLabel: contextMaxLabel,
      min,
      minLabel: contextMinLabel,
    },
  } = useSettingsSliderContext("SettingsSlider.Bounds");
  const boundFormatter = formatBound ?? String;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 text-muted-foreground text-sm leading-5",
        className
      )}
      {...props}
    >
      <span className="truncate">
        {minLabel ?? contextMinLabel ?? boundFormatter(min)}
      </span>
      <span className="truncate text-right">
        {maxLabel ?? contextMaxLabel ?? boundFormatter(max)}
      </span>
    </div>
  );
}
