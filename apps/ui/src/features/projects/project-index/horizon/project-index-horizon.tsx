"use client";

import dynamic from "next/dynamic";
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type { DevTweaksGroupDef } from "@/features/dev-tweaks/dev-tweaks-store";
import {
  type DevTweakValues,
  useDevTweaks,
} from "@/features/dev-tweaks/use-dev-tweaks";
import styles from "./horizon.module.css";
import type { HorizonWebglPhase } from "./horizon-webgl";

const HorizonWebgl = dynamic(() => import("./horizon-webgl"), { ssr: false });

/** Defaults mirror the `.horizon` custom-property block in horizon.module.css. */
const HORIZON_TWEAKS = {
  note: "horizon.module.css → .horizon",
  title: "Project · horizon glow",
  tweaks: {
    bleedX: {
      cssVar: "--horizon-bleed-x",
      label: "Glow horizontal bleed",
      max: 30,
      min: 0,
      unit: "%",
      value: 12,
    },
    canvasFps: {
      label: "Canvas frame cap",
      max: 60,
      min: 6,
      step: 1,
      value: 24,
    },
    canvasScale: {
      label: "Canvas render scale",
      max: 1,
      min: 0.25,
      step: 0.05,
      value: 0.5,
    },
    engineWebgl: {
      label: "Engine (0 static · 1 WebGL)",
      max: 1,
      min: 0,
      step: 1,
      value: 1,
    },
    glowCore: {
      cssVar: "--horizon-glow-core",
      label: "Glow core intensity",
      max: 100,
      min: 0,
      unit: "%",
      value: 56,
    },
    glowHeight: {
      cssVar: "--horizon-glow-h",
      label: "Glow height",
      max: 90,
      min: 10,
      unit: "%",
      value: 31,
    },
    glowMid: {
      cssVar: "--horizon-glow-mid",
      label: "Glow mid intensity",
      max: 100,
      min: 0,
      unit: "%",
      value: 38,
    },
    glowOuter: {
      cssVar: "--horizon-glow-outer",
      label: "Glow outer intensity",
      max: 100,
      min: 0,
      unit: "%",
      value: 13,
    },
    glowWidth: {
      cssVar: "--horizon-glow-w",
      label: "Glow width",
      max: 140,
      min: 20,
      unit: "%",
      value: 102,
    },
    glowY: {
      cssVar: "--horizon-glow-y",
      label: "Glow center Y",
      max: 150,
      min: 90,
      unit: "%",
      value: 110,
    },
    huesBlur: {
      cssVar: "--horizon-hues-blur",
      label: "Hues blur",
      max: 80,
      min: 0,
      unit: "px",
      value: 30,
    },
    huesCyan: {
      cssVar: "--horizon-hues-cyan",
      label: "Hues cyan intensity",
      max: 100,
      min: 0,
      unit: "%",
      value: 20,
    },
    huesDuration: {
      cssVar: "--horizon-hues-dur",
      label: "Hues period",
      max: 20,
      min: 1,
      step: 0.5,
      unit: "s",
      value: 5,
    },
    huesViolet: {
      cssVar: "--horizon-hues-violet",
      label: "Hues violet intensity",
      max: 100,
      min: 0,
      unit: "%",
      value: 24,
    },
    noiseOpacity: {
      cssVar: "--horizon-noise-opacity",
      label: "Noise opacity",
      max: 0.2,
      min: 0,
      step: 0.005,
      value: 0.05,
    },
    surgeBaseOpacity: {
      cssVar: "--horizon-surge-base-opacity",
      label: "Surge base opacity",
      max: 1,
      min: 0,
      step: 0.05,
      value: 0.55,
    },
    surgeCore: {
      cssVar: "--horizon-surge-core",
      label: "Surge core intensity",
      max: 100,
      min: 0,
      unit: "%",
      value: 36,
    },
    surgeDuration: {
      cssVar: "--horizon-surge-dur",
      label: "Surge period",
      max: 20,
      min: 1,
      step: 0.5,
      unit: "s",
      value: 5,
    },
    surgeHeight: {
      cssVar: "--horizon-surge-h",
      label: "Surge height",
      max: 90,
      min: 10,
      unit: "%",
      value: 40,
    },
    surgeMid: {
      cssVar: "--horizon-surge-mid",
      label: "Surge mid intensity",
      max: 100,
      min: 0,
      unit: "%",
      value: 16,
    },
    surgeOpacityMax: {
      cssVar: "--horizon-surge-op-max",
      label: "Surge opacity max",
      max: 1,
      min: 0,
      step: 0.05,
      value: 0.95,
    },
    surgeOpacityMin: {
      cssVar: "--horizon-surge-op-min",
      label: "Surge opacity min",
      max: 1,
      min: 0,
      step: 0.05,
      value: 0.45,
    },
    surgeScaleMax: {
      cssVar: "--horizon-surge-scale-max",
      label: "Surge scale max",
      max: 1.8,
      min: 1,
      step: 0.01,
      value: 1.22,
    },
    surgeScaleMin: {
      cssVar: "--horizon-surge-scale-min",
      label: "Surge scale min",
      max: 1,
      min: 0.5,
      step: 0.01,
      value: 0.85,
    },
    surgeWidth: {
      cssVar: "--horizon-surge-w",
      label: "Surge width",
      max: 160,
      min: 20,
      unit: "%",
      value: 72,
    },
    surgeY: {
      cssVar: "--horizon-surge-y",
      label: "Surge center Y",
      max: 150,
      min: 90,
      unit: "%",
      value: 114,
    },
    swellDuration: {
      cssVar: "--horizon-swell-dur",
      label: "Swell period",
      max: 20,
      min: 1,
      step: 0.5,
      unit: "s",
      value: 6,
    },
    swellOpacityMin: {
      cssVar: "--horizon-swell-op-min",
      label: "Swell opacity min",
      max: 1,
      min: 0,
      step: 0.05,
      value: 0.75,
    },
    swellScaleMax: {
      cssVar: "--horizon-swell-scale-max",
      label: "Swell scale max",
      max: 1.6,
      min: 1,
      step: 0.01,
      value: 1.12,
    },
    swellScaleMin: {
      cssVar: "--horizon-swell-scale-min",
      label: "Swell scale min",
      max: 1,
      min: 0.5,
      step: 0.01,
      value: 0.9,
    },
  },
} satisfies DevTweaksGroupDef;

export type HorizonTweakValues = DevTweakValues<
  (typeof HORIZON_TWEAKS)["tweaks"]
>;

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
 * context loss, and the ⌃⌥T engine knob's 0 position (AIM-77).
 */
export function ProjectIndexHorizon() {
  const { style, values } = useDevTweaks(
    "project-index-horizon",
    HORIZON_TWEAKS
  );
  const reducedMotion = usePrefersReducedMotion();
  const [canvasPhase, setCanvasPhase] = useState<"active" | "failed" | "idle">(
    "idle"
  );

  const wantsWebgl = !reducedMotion && values.engineWebgl >= 0.5;
  useEffect(() => {
    if (!wantsWebgl) {
      // Leaving the WebGL engine (dev knob / reduced-motion) resets the
      // attempt; a context-loss "failed" stays sticky otherwise.
      setCanvasPhase("idle");
    }
  }, [wantsWebgl]);

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
