"use client";

import {
  type CssVarBinding,
  cssVarOverrides,
  type DialConfig,
  type ResolvedValues,
  useDialKit,
} from "@workspace/dev-tweaks";
import dynamic from "next/dynamic";
import {
  Component,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import styles from "./horizon.module.css";
import type { HorizonWebglPhase } from "./horizon-webgl";

const HorizonWebgl = dynamic(() => import("./horizon-webgl"), { ssr: false });

/**
 * Defaults mirror the `.horizon` custom-property block in horizon.module.css.
 * DialKit tuples are [default, min, max, step]. Steps are explicit —
 * DialKit's auto-inferred step can be coarser than a default (e.g. 102 with
 * step 5), and its sliders snap values onto the step grid.
 */
const HORIZON_TWEAKS = {
  bleedX: [12, 0, 30, 1],
  canvasFps: [24, 6, 60, 1],
  canvasScale: [0.5, 0.25, 1, 0.05],
  // 0 static · 1 WebGL
  engineWebgl: [1, 0, 1, 1],
  glowCore: [56, 0, 100, 1],
  glowHeight: [31, 10, 90, 1],
  glowMid: [38, 0, 100, 1],
  glowOuter: [13, 0, 100, 1],
  glowWidth: [102, 20, 140, 1],
  glowY: [110, 90, 150, 1],
  huesBlur: [30, 0, 80, 1],
  huesCyan: [20, 0, 100, 1],
  huesDuration: [5, 1, 20, 0.5],
  huesViolet: [24, 0, 100, 1],
  noiseOpacity: [0.05, 0, 0.2, 0.005],
  surgeBaseOpacity: [0.55, 0, 1, 0.05],
  surgeCore: [36, 0, 100, 1],
  surgeDuration: [5, 1, 20, 0.5],
  surgeHeight: [40, 10, 90, 1],
  surgeMid: [16, 0, 100, 1],
  surgeOpacityMax: [0.95, 0, 1, 0.05],
  surgeOpacityMin: [0.45, 0, 1, 0.05],
  surgeScaleMax: [1.22, 1, 1.8, 0.01],
  surgeScaleMin: [0.85, 0.5, 1, 0.01],
  surgeWidth: [72, 20, 160, 1],
  surgeY: [114, 90, 150, 1],
  swellDuration: [6, 1, 20, 0.5],
  swellOpacityMin: [0.75, 0, 1, 0.05],
  swellScaleMax: [1.12, 1, 1.6, 0.01],
  swellScaleMin: [0.9, 0.5, 1, 0.01],
} satisfies DialConfig;

/** CSS custom properties (horizon.module.css → `.horizon`) driven per knob. */
const HORIZON_CSS_VARS: Partial<
  Record<keyof typeof HORIZON_TWEAKS, CssVarBinding>
> = {
  bleedX: { cssVar: "--horizon-bleed-x", unit: "%" },
  glowCore: { cssVar: "--horizon-glow-core", unit: "%" },
  glowHeight: { cssVar: "--horizon-glow-h", unit: "%" },
  glowMid: { cssVar: "--horizon-glow-mid", unit: "%" },
  glowOuter: { cssVar: "--horizon-glow-outer", unit: "%" },
  glowWidth: { cssVar: "--horizon-glow-w", unit: "%" },
  glowY: { cssVar: "--horizon-glow-y", unit: "%" },
  huesBlur: { cssVar: "--horizon-hues-blur", unit: "px" },
  huesCyan: { cssVar: "--horizon-hues-cyan", unit: "%" },
  huesDuration: { cssVar: "--horizon-hues-dur", unit: "s" },
  huesViolet: { cssVar: "--horizon-hues-violet", unit: "%" },
  noiseOpacity: { cssVar: "--horizon-noise-opacity" },
  surgeBaseOpacity: { cssVar: "--horizon-surge-base-opacity" },
  surgeCore: { cssVar: "--horizon-surge-core", unit: "%" },
  surgeDuration: { cssVar: "--horizon-surge-dur", unit: "s" },
  surgeHeight: { cssVar: "--horizon-surge-h", unit: "%" },
  surgeMid: { cssVar: "--horizon-surge-mid", unit: "%" },
  surgeOpacityMax: { cssVar: "--horizon-surge-op-max" },
  surgeOpacityMin: { cssVar: "--horizon-surge-op-min" },
  surgeScaleMax: { cssVar: "--horizon-surge-scale-max" },
  surgeScaleMin: { cssVar: "--horizon-surge-scale-min" },
  surgeWidth: { cssVar: "--horizon-surge-w", unit: "%" },
  surgeY: { cssVar: "--horizon-surge-y", unit: "%" },
  swellDuration: { cssVar: "--horizon-swell-dur", unit: "s" },
  swellOpacityMin: { cssVar: "--horizon-swell-op-min" },
  swellScaleMax: { cssVar: "--horizon-swell-scale-max" },
  swellScaleMin: { cssVar: "--horizon-swell-scale-min" },
};

export type HorizonTweakValues = ResolvedValues<typeof HORIZON_TWEAKS>;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

let reducedMotionQuery: MediaQueryList | null = null;
const getReducedMotionQuery = (): MediaQueryList => {
  reducedMotionQuery ??= window.matchMedia(REDUCED_MOTION_QUERY);
  return reducedMotionQuery;
};
const subscribeReducedMotion = (onChange: () => void): (() => void) => {
  const query = getReducedMotionQuery();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};
const getReducedMotion = (): boolean => getReducedMotionQuery().matches;
const getServerReducedMotion = (): boolean => true;

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    getServerReducedMotion
  );
}

/**
 * Render-error boundary so a failed lazy chunk (e.g. deploy skew) degrades
 * to the static glow instead of bubbling to the route error boundary —
 * chunk-load failure is one of the four AIM-77 static-fallback cases.
 */
class HorizonCanvasBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Ambient glow behind the project index. The WebGL engine (default) renders
 * the animated layers at a capped frame rate; the DOM gradient layers are
 * the static fallback for reduced-motion, canvas load, WebGL-init failure,
 * context loss, and the dev-tweaks engine knob's 0 position (AIM-77).
 */
export function ProjectIndexHorizon() {
  const values = useDialKit("Project · horizon glow", HORIZON_TWEAKS, {
    id: "project-index-horizon",
    persist: { storage: "sessionStorage" },
  });
  const style = useMemo(
    () => cssVarOverrides(HORIZON_TWEAKS, values, HORIZON_CSS_VARS),
    [values]
  );
  const reducedMotion = usePrefersReducedMotion();
  const [canvasPhase, setCanvasPhase] = useState<"active" | "failed" | "idle">(
    "idle"
  );

  const wantsWebgl = !reducedMotion && values.engineWebgl >= 0.5;
  const [prevWantsWebgl, setPrevWantsWebgl] = useState(wantsWebgl);
  if (wantsWebgl !== prevWantsWebgl) {
    setPrevWantsWebgl(wantsWebgl);
    if (!wantsWebgl) {
      // Leaving the WebGL engine (dev knob / reduced-motion) resets the
      // attempt; a context-loss "failed" stays sticky otherwise.
      setCanvasPhase("idle");
    }
  }

  const handlePhase = useCallback((phase: HorizonWebglPhase) => {
    setCanvasPhase(phase);
  }, []);
  const handleCanvasError = useCallback(() => {
    setCanvasPhase("failed");
  }, []);

  const webglActive = wantsWebgl && canvasPhase !== "failed";

  return (
    <div
      className={styles.horizon}
      data-canvas={
        webglActive && canvasPhase === "active" ? "active" : undefined
      }
      data-slot="project-index-horizon"
      style={style}
    >
      <div className={styles.horizonGlow} />
      <div className={styles.horizonHues} />
      <div className={styles.horizonSurge} />
      {webglActive ? (
        <HorizonCanvasBoundary onError={handleCanvasError}>
          <HorizonWebgl onPhase={handlePhase} values={values} />
        </HorizonCanvasBoundary>
      ) : null}
      <div className={styles.horizonNoise} />
    </div>
  );
}
