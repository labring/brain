/* eslint-disable react-hooks/refs -- ported panel render-update patterns kept structurally intact */
import { useLayoutEffect, useRef, useState } from "react";

interface SegmentedControlOption<T extends string> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  onChange: (value: T) => void;
  options: SegmentedControlOption<T>[];
  value: T;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);
  const [pillStyle, setPillStyle] = useState<{
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const activeButton = container.querySelector(
      `[data-value="${value}"]`
    ) as HTMLElement | null;
    if (!activeButton) {
      return;
    }
    const next = {
      left: activeButton.offsetLeft,
      width: activeButton.offsetWidth,
    };
    setPillStyle((prev) =>
      prev !== null && prev.left === next.left && prev.width === next.width
        ? prev
        : next
    );
  }, [value]);

  // Enable transition after first render
  const shouldAnimate = hasAnimated.current;
  hasAnimated.current = true;

  return (
    <div className="dev-tweaks-segmented" ref={containerRef}>
      {pillStyle && (
        <div
          className="dev-tweaks-segmented-pill"
          style={{
            left: pillStyle.left,
            width: pillStyle.width,
            transition: shouldAnimate
              ? "left 0.2s cubic-bezier(0.25, 1, 0.5, 1), width 0.2s cubic-bezier(0.25, 1, 0.5, 1)"
              : "none",
          }}
        />
      )}

      {options.map((option) => {
        const isActive = value === option.value;
        return (
          <button
            className="dev-tweaks-segmented-button"
            data-active={String(isActive)}
            data-value={option.value}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
