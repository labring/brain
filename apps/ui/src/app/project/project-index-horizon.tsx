"use client";

import type { DevTweaksGroupDef } from "@/features/dev-tweaks/dev-tweaks-store";
import { useDevTweaks } from "@/features/dev-tweaks/use-dev-tweaks";
import styles from "./project-index.module.css";

/** Defaults mirror the `.horizon` custom-property block in the CSS module. */
const HORIZON_TWEAKS = {
  note: "project-index.module.css → .horizon",
  title: "Project · horizon glow",
  tweaks: {
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
      value: 40,
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
      value: 18,
    },
    glowWidth: {
      cssVar: "--horizon-glow-w",
      label: "Glow width",
      max: 140,
      min: 20,
      unit: "%",
      value: 64,
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
      value: 8,
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
      value: 9,
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

export function ProjectIndexHorizon() {
  const { style } = useDevTweaks("project-index-horizon", HORIZON_TWEAKS);

  return (
    <div
      className={styles.horizon}
      data-slot="project-index-horizon"
      style={style}
    >
      <div className={styles.horizonGlow} />
      <div className={styles.horizonHues} />
      <div className={styles.horizonSurge} />
      <div className={styles.horizonNoise} />
    </div>
  );
}
