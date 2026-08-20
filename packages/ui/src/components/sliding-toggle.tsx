"use client";

import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export interface SlidingToggleOption<TValue extends string = string> {
  ariaLabel?: string;
  disabled?: boolean;
  label: ReactNode;
  value: TValue;
}

export type SlidingToggleSize = "default" | "sm";
export type SlidingToggleWidth = "auto" | "full";
export type SlidingToggleSegments = "equal" | "fit";

export interface SlidingToggleProps<TValue extends string = string> {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  indicatorClassName?: string;
  itemClassName?: string;
  onValueChange: (value: TValue) => void;
  options: readonly SlidingToggleOption<TValue>[];
  /**
   * "equal" divides the track into identical cells; "fit" sizes each segment
   * to its label and the indicator slides and resizes to hug the active one.
   */
  segments?: SlidingToggleSegments;
  size?: SlidingToggleSize;
  value: TValue;
  width?: SlidingToggleWidth;
}

const slidingToggleSizeClasses = {
  default: {
    indicator: "rounded-lg",
    item: "!rounded-lg h-9 px-2 text-sm",
    root: "h-9 rounded-lg",
  },
  sm: {
    indicator: "rounded-md",
    item: "!rounded-md h-8 px-3 text-xs",
    root: "h-8 rounded-md",
  },
} satisfies Record<
  SlidingToggleSize,
  { indicator: string; item: string; root: string }
>;

const slidingToggleWidthClasses = {
  auto: "w-auto",
  full: "w-full",
} satisfies Record<SlidingToggleWidth, string>;

interface FitIndicatorRect {
  left: number;
  width: number;
}

// Measurement must run before paint in the browser, but useLayoutEffect is a
// no-op warning during server rendering.
const useBrowserLayoutEffect =
  typeof document === "undefined" ? useEffect : useLayoutEffect;

export function SlidingToggle<TValue extends string = string>({
  ariaLabel,
  className,
  disabled = false,
  indicatorClassName,
  itemClassName,
  onValueChange,
  options,
  segments = "equal",
  size = "default",
  value,
  width = "full",
}: SlidingToggleProps<TValue>) {
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const [fitIndicator, setFitIndicator] = useState<FitIndicatorRect | null>(
    null
  );

  useBrowserLayoutEffect(() => {
    if (segments !== "fit") {
      return;
    }
    // The indicator's parent is the toggle-group track, which also anchors
    // the items' offsetLeft — no ref plumbing through ToggleGroup. (Not
    // offsetParent: the indicator is display-hidden before first measure.)
    const track = indicatorRef.current?.parentElement;
    if (track == null) {
      return;
    }
    const measure = () => {
      const pressed = track.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (pressed == null) {
        setFitIndicator(null);
        return;
      }
      const next = { left: pressed.offsetLeft, width: pressed.offsetWidth };
      setFitIndicator((previous) =>
        previous?.left === next.left && previous?.width === next.width
          ? previous
          : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [segments, value, options]);

  if (options.length === 0) {
    return null;
  }

  const sizeClasses = slidingToggleSizeClasses[size];
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  let indicatorStyle: CSSProperties | undefined = {
    transform: `translateX(${selectedIndex * 100}%)`,
    width: `${100 / options.length}%`,
  };
  if (segments === "fit") {
    indicatorStyle =
      fitIndicator == null
        ? undefined
        : {
            transform: `translateX(${fitIndicator.left}px)`,
            width: `${fitIndicator.width}px`,
          };
  }
  const groupStyle = {
    gridTemplateColumns:
      segments === "fit"
        ? `repeat(${options.length}, auto)`
        : `repeat(${options.length}, minmax(0, 1fr))`,
  } satisfies CSSProperties;

  return (
    <ToggleGroup
      aria-label={ariaLabel}
      className={cn(
        "relative grid overflow-hidden bg-input/30 p-0 text-foreground",
        sizeClasses.root,
        slidingToggleWidthClasses[width],
        className
      )}
      onValueChange={(nextValue) => {
        const next = nextValue[0];
        const nextOption = options.find((option) => option.value === next);
        if (nextOption != null) {
          onValueChange(nextOption.value);
        }
      }}
      spacing={0}
      style={groupStyle}
      value={[value]}
      variant="outline"
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 z-0 bg-input duration-200 ease-out-strong motion-reduce:transition-none dark:bg-[#36383c]",
          segments === "fit"
            ? "transition-[transform,width]"
            : "transition-transform",
          // Until the first client-side measurement the pill has no position;
          // the pressed item paints its own background instead (see below).
          segments === "fit" && fitIndicator == null && "hidden",
          sizeClasses.indicator,
          indicatorClassName
        )}
        data-slot="sliding-toggle-indicator"
        ref={indicatorRef}
        style={indicatorStyle}
      />
      {options.map((option) => (
        <ToggleGroupItem
          aria-label={option.ariaLabel}
          className={cn(
            // Constant font weight: a 400→500 flip on selection nudges label
            // width, which re-measures the fit indicator mid-slide.
            "relative z-10 min-w-0 cursor-pointer border-0 bg-transparent font-medium duration-200 ease-out-strong hover:bg-transparent aria-pressed:bg-transparent data-[state=on]:bg-transparent motion-reduce:transition-none [&[aria-pressed=true]_svg]:text-blue-400",
            segments === "fit" &&
              fitIndicator == null &&
              "aria-pressed:bg-input dark:aria-pressed:bg-[#36383c]",
            sizeClasses.item,
            itemClassName
          )}
          disabled={disabled || option.disabled}
          key={option.value}
          value={option.value}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
