/**
 * Pure animation math for the horizon WebGL engine (AIM-77).
 *
 * Reproduces the CSS semantics of the deleted horizon keyframes — the
 * `ease-in-out` timing keyword, `animation-direction: alternate`, and the
 * negative `animation-delay` on the hues layer — so the shader poses keep
 * the exact motion that was signed off when the CSS engine was retired.
 */

const EASE_X1 = 0.42;
const EASE_X2 = 0.58;
const NEWTON_ITERATIONS = 8;
const NEWTON_EPSILON = 1e-6;

const bezierAxis = (u: number, p1: number, p2: number): number => {
  const inv = 1 - u;
  return 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u;
};

const bezierAxisDerivative = (u: number, p1: number, p2: number): number => {
  const inv = 1 - u;
  return 3 * inv * inv * p1 + 6 * inv * u * (p2 - p1) + 3 * u * u * (1 - p2);
};

/** cubic-bezier(0.42, 0, 0.58, 1) — the CSS `ease-in-out` keyword. */
export function cssEaseInOut(progress: number): number {
  if (progress <= 0) {
    return 0;
  }
  if (progress >= 1) {
    return 1;
  }
  let u = progress;
  for (let i = 0; i < NEWTON_ITERATIONS; i++) {
    const error = bezierAxis(u, EASE_X1, EASE_X2) - progress;
    if (Math.abs(error) < NEWTON_EPSILON) {
      break;
    }
    const slope = bezierAxisDerivative(u, EASE_X1, EASE_X2);
    if (Math.abs(slope) < NEWTON_EPSILON) {
      break;
    }
    u = Math.min(1, Math.max(0, u - error / slope));
  }
  // With y1=0, y2=1 the value curve reduces to u²(3 − 2u).
  return u * u * (3 - 2 * u);
}

/**
 * Directed, eased progress of an infinite `alternate` animation at `timeSec`.
 * Even iterations run forward, odd ones reverse; the timing function applies
 * after the direction flip, matching CSS. A negative delay advances phase —
 * `delaySec = -durationSec` starts at the `to` state moving backwards.
 */
export function alternateEasedProgress(
  timeSec: number,
  durationSec: number,
  delaySec = 0
): number {
  if (durationSec <= 0) {
    return 1;
  }
  const local = (timeSec - delaySec) / durationSec;
  if (local <= 0) {
    return 0;
  }
  const iteration = Math.floor(local);
  const fraction = local - iteration;
  const directed = iteration % 2 === 0 ? fraction : 1 - fraction;
  return cssEaseInOut(directed);
}

export interface LayerPose {
  opacity: number;
  scale: number;
}

/** The horizon dev-tweak knobs the animation math consumes (raw numbers). */
export interface HorizonMotionValues {
  huesDuration: number;
  surgeDuration: number;
  surgeOpacityMax: number;
  surgeOpacityMin: number;
  surgeScaleMax: number;
  surgeScaleMin: number;
  swellDuration: number;
  swellOpacityMin: number;
  swellScaleMax: number;
  swellScaleMin: number;
}

const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

/** `.horizonGlow` — `horizon-swell` keyframes over the swell duration. */
export function glowPose(
  timeSec: number,
  values: HorizonMotionValues
): LayerPose {
  const p = alternateEasedProgress(timeSec, values.swellDuration);
  return {
    opacity: lerp(values.swellOpacityMin, 1, p),
    scale: lerp(values.swellScaleMin, values.swellScaleMax, p),
  };
}

/**
 * `.horizonHues` — same `horizon-swell` keyframes but over the hues duration
 * with `animation-delay: calc(-1 * duration)`, i.e. starting reversed.
 */
export function huesPose(
  timeSec: number,
  values: HorizonMotionValues
): LayerPose {
  const p = alternateEasedProgress(
    timeSec,
    values.huesDuration,
    -values.huesDuration
  );
  return {
    opacity: lerp(values.swellOpacityMin, 1, p),
    scale: lerp(values.swellScaleMin, values.swellScaleMax, p),
  };
}

/** `.horizonSurge` — `horizon-surge` keyframes over the surge duration. */
export function surgePose(
  timeSec: number,
  values: HorizonMotionValues
): LayerPose {
  const p = alternateEasedProgress(timeSec, values.surgeDuration);
  return {
    opacity: lerp(values.surgeOpacityMin, values.surgeOpacityMax, p),
    scale: lerp(values.surgeScaleMin, values.surgeScaleMax, p),
  };
}
