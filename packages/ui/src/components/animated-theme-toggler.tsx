"use client";

import { cn } from "@workspace/ui/lib/utils";
import { Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  type ComponentPropsWithRef,
  type MutableRefObject,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export type TransitionVariant =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "hexagon"
  | "rectangle"
  | "star";

export interface AnimatedThemeTogglerProps
  extends ComponentPropsWithRef<"button"> {
  /** Optional visible label rendered after the icon (accessible name stays
   *  the built-in "Toggle theme" sr-only text). */
  children?: React.ReactNode;
  /** Diffusion duration in milliseconds (View Transitions only). */
  duration?: number;
  /** Expand from the viewport center instead of the button center. */
  fromCenter?: boolean;
  /** Classes for the icon slot (e.g. to align it with a list-row icon column). */
  iconClassName?: string;
  /** Ref to the icon slot span (e.g. as a Tooltip anchor in list rows). */
  iconRef?: Ref<HTMLSpanElement>;
  /** Called on toggle with the new theme. Pair with `theme` for controlled usage. */
  onThemeChange?: (theme: "light" | "dark") => void;
  /** React 19 ref-as-prop; merged with the internal button ref so callers
   *  (e.g. Tooltip anchors) can observe the element without stealing it. */
  ref?: Ref<HTMLButtonElement>;
  /**
   * Controlled theme value. When provided, the parent owns persistence
   * (next-themes) and this component will not write to localStorage.
   */
  theme?: "light" | "dark";
  /** Shape of the clip-path reveal. Defaults to a circle. */
  variant?: TransitionVariant;
}

/**
 * Animated light/dark theme toggle (ported from magicui's
 * animated-theme-toggler, adapted for next-themes control).
 *
 * The page reveal is a native View Transition: `document.startViewTransition`
 * snapshots the old page, the callback flips the `dark` class on <html>
 * synchronously (so the new snapshot already carries the new theme), and a
 * clip-path keyframe animation on `::view-transition-new(root)` grows the new
 * page out from the button. Browsers without View Transitions apply the theme
 * change directly — no animation, no error. The globals.css rules scoped to
 * `html[data-sealai-theme-vt="active"]` (duration sync + collapsed clip pin
 * for Firefox) activate only while a toggle is in flight, so other view
 * transitions in the app are untouched.
 *
 * In controlled mode the class flip is done here for snapshot correctness;
 * the owner's `setTheme` runs afterwards and re-applies the same class
 * (idempotent) while persisting the choice.
 *
 * The Sun/Moon micro-animation (motion) deliberately runs after the view
 * transition settles: while a VT is active the live DOM is frozen, so icons
 * crossfade in place right after the circular reveal completes.
 */
function polygonCollapsed(point: string, vertexCount: number): string {
  const pairs = Array.from({ length: vertexCount }, () => point).join(", ");
  return `polygon(${pairs})`;
}

// All coordinates are percentages of the snapshot reference box: Chrome
// renders absolute px clip-path coordinates unscaled on fractional display
// scales for the first transition after load, so px values can land at the
// wrong position.
function getThemeTransitionClipPaths(
  variant: TransitionVariant,
  cx: number,
  cy: number,
  maxRadius: number,
  viewportWidth: number,
  viewportHeight: number
): [string, string] {
  const toX = (x: number) => `${(x / viewportWidth) * 100}%`;
  const toY = (y: number) => `${(y / viewportHeight) * 100}%`;
  const point = (x: number, y: number) => `${toX(x)} ${toY(y)}`;
  // circle() percentage radii resolve against hypot(w, h) / sqrt(2) of the
  // reference box.
  const toRadius = (r: number) =>
    `${(r / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2)) * 100}%`;

  switch (variant) {
    case "circle":
      return [
        `circle(0% at ${point(cx, cy)})`,
        `circle(${toRadius(maxRadius)} at ${point(cx, cy)})`,
      ];
    case "square": {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const halfSide = Math.max(halfW, halfH) * 1.05;
      const end = [
        point(cx - halfSide, cy - halfSide),
        point(cx + halfSide, cy - halfSide),
        point(cx + halfSide, cy + halfSide),
        point(cx - halfSide, cy + halfSide),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 4), `polygon(${end})`];
    }
    case "triangle": {
      const scale = maxRadius * 2.2;
      const dx = (Math.sqrt(3) / 2) * scale;
      const verts = [
        point(cx, cy - scale),
        point(cx + dx, cy + 0.5 * scale),
        point(cx - dx, cy + 0.5 * scale),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 3), `polygon(${verts})`];
    }
    case "diamond": {
      // Slightly larger than the view-transition circle radius so
      // axis-aligned coverage matches the circle reveal.
      const R = maxRadius * Math.SQRT2;
      const end = [
        point(cx, cy - R),
        point(cx + R, cy),
        point(cx, cy + R),
        point(cx - R, cy),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 4), `polygon(${end})`];
    }
    case "hexagon": {
      const R = maxRadius * Math.SQRT2;
      const verts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        verts.push(point(cx + R * Math.cos(a), cy + R * Math.sin(a)));
      }
      return [
        polygonCollapsed(point(cx, cy), 6),
        `polygon(${verts.join(", ")})`,
      ];
    }
    case "rectangle": {
      const halfW = Math.max(cx, viewportWidth - cx);
      const halfH = Math.max(cy, viewportHeight - cy);
      const end = [
        point(cx - halfW, cy - halfH),
        point(cx + halfW, cy - halfH),
        point(cx + halfW, cy + halfH),
        point(cx - halfW, cy + halfH),
      ].join(", ");
      return [polygonCollapsed(point(cx, cy), 4), `polygon(${end})`];
    }
    case "star": {
      // Small overscan so the last frames never leave a 1px seam before the
      // transition group ends.
      const R = maxRadius * Math.SQRT2 * 1.03;
      const innerRatio = 0.42;
      const starPolygon = (radius: number) => {
        const verts: string[] = [];
        for (let i = 0; i < 5; i++) {
          const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
          verts.push(
            point(
              cx + radius * Math.cos(outerA),
              cy + radius * Math.sin(outerA)
            )
          );
          const innerA = outerA + Math.PI / 5;
          verts.push(
            point(
              cx + radius * innerRatio * Math.cos(innerA),
              cy + radius * innerRatio * Math.sin(innerA)
            )
          );
        }
        return `polygon(${verts.join(", ")})`;
      };
      const startR = Math.max(2, R * 0.025);
      return [starPolygon(startR), starPolygon(R)];
    }
    default:
      return [
        `circle(0% at ${point(cx, cy)})`,
        `circle(${toRadius(maxRadius)} at ${point(cx, cy)})`,
      ];
  }
}

export const AnimatedThemeToggler = ({
  className,
  duration = 400,
  variant,
  fromCenter = false,
  theme,
  onThemeChange,
  iconClassName,
  iconRef,
  children,
  onClick,
  ref,
  ...props
}: AnimatedThemeTogglerProps) => {
  const shape = variant ?? "circle";
  const isControlled = theme !== undefined;
  const [internalIsDark, setInternalIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Ref gates re-entrant clicks synchronously; the paired state hides the
  // icon while the transition is in flight (a render-time read of the ref
  // would never re-show it — refs do not trigger renders).
  const [isTransitioning, setIsTransitioning] = useState(false);
  const isDark = isControlled ? theme === "dark" : internalIsDark;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isTransitioningRef = useRef(false);
  const activeAnimRef = useRef<Animation | null>(null);

  const cancelAnim = useCallback(() => {
    activeAnimRef.current?.cancel();
    activeAnimRef.current = null;
  }, []);

  const setButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as MutableRefObject<HTMLButtonElement | null>).current = node;
      }
    },
    [ref]
  );

  // No SSR truth for the theme; the icon appears once mounted so the Sun/Moon
  // crossfade never has to resolve a hydration mismatch.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      cancelAnim();
      const root = document.documentElement;
      if (root.dataset.sealaiThemeVt !== "active") {
        return;
      }
      delete root.dataset.sealaiThemeVt;
      root.style.removeProperty("--sealai-theme-toggle-vt-duration");
      root.style.removeProperty("--sealai-theme-vt-clip-from");
    };
  }, [cancelAnim]);

  // Uncontrolled mode mirrors the <html> class so an external owner (e.g. a
  // script that applies a stored theme) still drives the icon.
  useEffect(() => {
    if (isControlled) {
      return;
    }

    const updateTheme = () => {
      setInternalIsDark(document.documentElement.classList.contains("dark"));
    };

    updateTheme();

    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, [isControlled]);

  const toggleTheme = useCallback(() => {
    const button = buttonRef.current;
    if (
      !button ||
      isTransitioningRef.current ||
      document.documentElement.dataset.sealaiThemeVt === "active"
    ) {
      return;
    }

    // innerWidth/innerHeight (not visualViewport): percentages must resolve
    // against the snapshot reference box, which includes classic scrollbars.
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x: number;
    let y: number;
    if (fromCenter) {
      x = viewportWidth / 2;
      y = viewportHeight / 2;
    } else {
      const { top, left, width, height } = button.getBoundingClientRect();
      x = left + width / 2;
      y = top + height / 2;
    }

    const maxRadius = Math.hypot(
      Math.max(x, viewportWidth - x),
      Math.max(y, viewportHeight - y)
    );

    const applyTheme = () => {
      const newTheme = !isDark;
      // Flip the class synchronously so the View Transitions API snapshots
      // the new theme inside the startViewTransition callback. In controlled
      // mode this is the authoritative paint; the owner's setTheme re-applies
      // the same class afterwards (idempotent) and persists the choice.
      const root = document.documentElement;
      root.classList.toggle("dark");
      root.style.colorScheme = newTheme ? "dark" : "light";
      if (isControlled) {
        onThemeChange?.(newTheme ? "dark" : "light");
      } else {
        setInternalIsDark(newTheme);
        localStorage.setItem("theme", newTheme ? "dark" : "light");
      }
    };

    if (typeof document.startViewTransition !== "function") {
      applyTheme();
      return;
    }

    const clipPath = getThemeTransitionClipPaths(
      shape,
      x,
      y,
      maxRadius,
      viewportWidth,
      viewportHeight
    );

    const root = document.documentElement;
    root.dataset.sealaiThemeVt = "active";
    root.style.setProperty(
      "--sealai-theme-toggle-vt-duration",
      `${duration}ms`
    );
    // Pin the collapsed clip-path via CSS so Firefox does not paint the new
    // theme unclipped between snapshot and the ready.then() JS animation.
    root.style.setProperty("--sealai-theme-vt-clip-from", clipPath[0]);
    const cleanup = () => {
      isTransitioningRef.current = false;
      setIsTransitioning(false);
      delete root.dataset.sealaiThemeVt;
      root.style.removeProperty("--sealai-theme-toggle-vt-duration");
      root.style.removeProperty("--sealai-theme-vt-clip-from");
      cancelAnim();
    };

    isTransitioningRef.current = true;
    setIsTransitioning(true);
    const transition = document.startViewTransition(applyTheme);
    if (typeof transition?.finished?.finally === "function") {
      transition.finished.finally(cleanup).catch(() => undefined);
    } else {
      cleanup();
    }

    const ready = transition?.ready;
    if (ready && typeof ready.then === "function") {
      ready
        .then(() => {
          const anim = document.documentElement.animate(
            { clipPath },
            {
              duration,
              // Star: linear avoids easing overshoot that fights polygon
              // interpolation at t→1; the VT group duration is synced above.
              easing: shape === "star" ? "linear" : "ease-in-out",
              fill: "forwards",
              pseudoElement: "::view-transition-new(root)",
            }
          );
          activeAnimRef.current = anim;
        })
        .catch(() => undefined);
    }
  }, [
    shape,
    fromCenter,
    duration,
    isDark,
    isControlled,
    onThemeChange,
    cancelAnim,
  ]);

  return (
    <button
      {...props}
      className={cn(className)}
      onClick={(event) => {
        // Compose with a caller-provided handler: a TooltipTrigger render
        // injects its own onClick, which must not silence the toggle.
        onClick?.(event);
        if (!event.defaultPrevented) {
          toggleTheme();
        }
      }}
      ref={setButtonRef}
      type="button"
    >
      <span
        className={cn(
          "relative inline-flex size-4 shrink-0 items-center justify-center",
          iconClassName
        )}
        data-slot="animated-theme-toggler-icon"
        ref={iconRef}
      >
        {/* The live DOM is frozen while a view transition is in flight, so
            defer the icon crossfade until the reveal has settled. */}
        {mounted && !isTransitioning ? (
          <AnimatePresence initial={false} mode="wait">
            {isDark ? (
              <motion.span
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                aria-hidden
                className="absolute inset-0 flex items-center justify-center"
                exit={{ opacity: 0, rotate: 90, scale: 0.5 }}
                initial={{ opacity: 0, rotate: -90, scale: 0.5 }}
                key="sun"
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <Sun className="size-4" strokeWidth={1.5} />
              </motion.span>
            ) : (
              <motion.span
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                aria-hidden
                className="absolute inset-0 flex items-center justify-center"
                exit={{ opacity: 0, rotate: -90, scale: 0.5 }}
                initial={{ opacity: 0, rotate: 90, scale: 0.5 }}
                key="moon"
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <Moon className="size-4" strokeWidth={1.5} />
              </motion.span>
            )}
          </AnimatePresence>
        ) : null}
      </span>
      {children}
      <span className="sr-only">Toggle theme</span>
    </button>
  );
};
