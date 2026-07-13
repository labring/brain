"use client";

import { cn } from "@workspace/ui/lib/utils";
import type { CSSProperties, ElementType } from "react";
import { memo } from "react";

export interface TextShimmerProps {
  as?: ElementType;
  children: string;
  className?: string;
  duration?: number;
  spread?: number;
}

/**
 * CSS-driven text shimmer (`.shimmer-text` keyframes in globals.css), so the
 * browser owns frame scheduling — no per-frame rAF style-writes from JS.
 * Under `prefers-reduced-motion: reduce` the animation never runs and the
 * parked gradient leaves the text on its static muted base layer.
 */
const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: TextShimmerProps) => {
  const dynamicSpread = (children?.length ?? 0) * spread;

  return (
    <Component
      className={cn(
        "shimmer-text relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent [background-position:100%_center]",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-foreground),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className
      )}
      style={
        {
          "--shimmer-duration": `${duration}s`,
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
    >
      {children}
    </Component>
  );
};

export const Shimmer = memo(ShimmerComponent);
