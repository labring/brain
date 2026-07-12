"use client";

import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef } from "react";

import { glowPose, huesPose, type LayerPose, surgePose } from "./horizon-anim";
import {
  clamp01,
  type OklabColor,
  type OutputColorSpace,
  oklabToGamma,
  parseCssColorToOklab,
} from "./horizon-color";
import styles from "./project-index.module.css";
import type { HorizonTweakValues } from "./project-index-horizon";

/**
 * WebGL engine for the project-index horizon (AIM-77). One fullscreen
 * fragment-shader pass reproduces the glow/hues/surge gradient layers from
 * the same dev-tweak values the CSS engine reads, but frame production is
 * throttled (`canvasFps`) and the backing store is undersized
 * (`canvasScale`) — the two levers infinite CSS animations cannot offer.
 * The static noise dither stays in the DOM on top of this canvas.
 */

const VERTEX_SHADER = /* glsl */ `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

/**
 * Layer composition math: with an opaque backdrop, CSS `mix-blend-mode:
 * screen` of a premultiplied layer `s` reduces to `s + Cb·(1 − s)` per
 * channel, so the stack folds into `color + keep·backdrop`. A canvas only
 * carries one scalar alpha, so the per-channel `keep` residual is baked
 * against the sampled page background (`uBackdrop`) — exact over the flat
 * bg, off only by the faint dot-grid underneath (masked out down here).
 * Gradient stops interpolate in premultiplied OKLab (CSS Images 4 behavior
 * for non-legacy color stops); hues blur(30px) is approximated in JS by
 * widening the ellipse radii and dimming alpha.
 */
const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform float uBleed;
uniform vec3 uBackdrop;
uniform float uOutputP3;

uniform mat4 uGlowStops;
uniform vec4 uGlowStopPos;
uniform vec4 uGlowGeom;
uniform vec2 uGlowPose;

uniform mat4 uSurgeStops;
uniform vec4 uSurgeStopPos;
uniform vec4 uSurgeGeom;
uniform vec2 uSurgePose;

uniform vec4 uVioletColor;
uniform vec4 uVioletGeom;
uniform vec4 uCyanColor;
uniform vec4 uCyanGeom;
uniform float uHuesEdge;
uniform vec2 uHuesPose;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 oklabToLinearSrgb(vec3 lab) {
  float l = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
  float m = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
  float s = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
  vec3 lms = vec3(l * l * l, m * m * m, s * s * s);
  return vec3(
    dot(vec3(4.0767416621, -3.3077115913, 0.2309699292), lms),
    dot(vec3(-1.2684380046, 2.6097574011, -0.3413193965), lms),
    dot(vec3(-0.0041960863, -0.7034186147, 1.7076147010), lms)
  );
}

vec3 srgbTransfer(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

vec3 toOutputGamma(vec3 linearSrgb) {
  vec3 lin = linearSrgb;
  if (uOutputP3 > 0.5) {
    lin = vec3(
      dot(vec3(0.8224621, 0.1775380, 0.0), linearSrgb),
      dot(vec3(0.0331941, 0.9668058, 0.0), linearSrgb),
      dot(vec3(0.0170827, 0.0723974, 0.9105199), linearSrgb)
    );
  }
  return srgbTransfer(clamp(lin, 0.0, 1.0));
}

vec4 labStopToRgb(vec4 labPremult) {
  if (labPremult.a < 1e-4) {
    return vec4(0.0);
  }
  vec3 lab = labPremult.rgb / labPremult.a;
  return vec4(toOutputGamma(oklabToLinearSrgb(lab)) * labPremult.a, labPremult.a);
}

vec4 gradient4(mat4 stops, vec4 pos, float t) {
  if (t <= pos.x) {
    return stops[0];
  }
  if (t >= pos.w) {
    return stops[3];
  }
  vec4 a = stops[0];
  vec4 b = stops[1];
  float t0 = pos.x;
  float t1 = pos.y;
  if (t > pos.y) {
    a = stops[1];
    b = stops[2];
    t0 = pos.y;
    t1 = pos.z;
  }
  if (t > pos.z) {
    a = stops[2];
    b = stops[3];
    t0 = pos.z;
    t1 = pos.w;
  }
  float f = clamp((t - t0) / max(t1 - t0, 1e-5), 0.0, 1.0);
  return mix(a, b, f);
}

float ellipseT(vec2 q, vec2 center, vec2 radii, float scale) {
  vec2 origin = vec2(0.5, 1.0);
  vec2 p = origin + (q - origin) / max(scale, 1e-3);
  vec2 d = (p - center) / max(radii, vec2(1e-4));
  return length(d);
}

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 v = vec2(vUv.x, 1.0 - vUv.y);
  vec2 q = vec2((v.x + uBleed) / (1.0 + 2.0 * uBleed), v.y);

  float tGlow = ellipseT(q, uGlowGeom.zw, uGlowGeom.xy, uGlowPose.x);
  vec4 glow = labStopToRgb(gradient4(uGlowStops, uGlowStopPos, tGlow)) * uGlowPose.y;

  float tSurge = ellipseT(q, uSurgeGeom.zw, uSurgeGeom.xy, uSurgePose.x);
  vec4 surge = labStopToRgb(gradient4(uSurgeStops, uSurgeStopPos, tSurge)) * uSurgePose.y;

  float tViolet = ellipseT(q, uVioletGeom.zw, uVioletGeom.xy, uHuesPose.x);
  vec4 violet = uVioletColor * (1.0 - clamp(tViolet / uHuesEdge, 0.0, 1.0));
  float tCyan = ellipseT(q, uCyanGeom.zw, uCyanGeom.xy, uHuesPose.x);
  vec4 cyan = uCyanColor * (1.0 - clamp(tCyan / uHuesEdge, 0.0, 1.0));
  vec4 hues = (violet + cyan * (1.0 - violet.a)) * uHuesPose.y;

  vec3 g = glow.rgb;
  vec3 h = hues.rgb;
  vec3 u = surge.rgb;
  vec3 color = u + (1.0 - u) * (h + (1.0 - h) * g);
  vec3 keep = (1.0 - u) * (1.0 - h) * (1.0 - glow.a);
  float alpha = 1.0 - dot(keep, LUMA);
  vec3 rgb = color + (keep - (1.0 - alpha)) * uBackdrop;
  rgb += (hash21(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), alpha);
}
`;

const HUES_GRADIENT_EDGE = 0.75;
const VIOLET_ELLIPSE = { cx: 0.3, cy: 1.12, rx: 0.34, ry: 0.26 };
const CYAN_ELLIPSE = { cx: 0.7, cy: 1.14, rx: 0.36, ry: 0.28 };
const GLOW_STOP_POSITIONS = [0, 0.28, 0.52, 0.78];
const SURGE_STOP_POSITIONS = [0, 0.45, 0.8, 0.8];
const MIN_FPS = 1;
const MAX_FPS = 120;
const MIN_SCALE = 0.1;

const TOKEN_FALLBACKS = {
  background: "oklch(0.145 0 0)",
  blue400: "#60a5fa",
  blue500: "#3b82f6",
  blue600: "#2563eb",
  cyan400: "#22d3ee",
  violet600: "#7c3aed",
} as const;

const TOKEN_NAMES = {
  background: "--background",
  blue400: "--color-blue-400",
  blue500: "--color-blue-500",
  blue600: "--color-blue-600",
  cyan400: "--color-cyan-400",
  violet600: "--color-violet-600",
} as const;

type TokenKey = keyof typeof TOKEN_NAMES;
type TokenColors = Record<TokenKey, OklabColor>;

const BLACK: OklabColor = { a: 0, alpha: 1, b: 0, l: 0 };

function readTokenColors(): TokenColors {
  const style = getComputedStyle(document.documentElement);
  const read = (key: TokenKey): OklabColor =>
    parseCssColorToOklab(style.getPropertyValue(TOKEN_NAMES[key])) ??
    parseCssColorToOklab(TOKEN_FALLBACKS[key]) ??
    BLACK;
  return {
    background: read("background"),
    blue400: read("blue400"),
    blue500: read("blue500"),
    blue600: read("blue600"),
    cyan400: read("cyan400"),
    violet600: read("violet600"),
  };
}

/** Column-major mat4 of premultiplied-OKLab stops; null → transparent. */
function stopsMatrix(
  entries: readonly (readonly [OklabColor, number] | null)[]
): Float32Array<ArrayBuffer> {
  const mat = new Float32Array(16);
  entries.forEach((entry, i) => {
    if (!entry) {
      return;
    }
    const [color, alpha] = entry;
    const a = clamp01(alpha) * color.alpha;
    mat[i * 4] = color.l * a;
    mat[i * 4 + 1] = color.a * a;
    mat[i * 4 + 2] = color.b * a;
    mat[i * 4 + 3] = a;
  });
  return mat;
}

/** Premultiplied output-gamma rgba for the single-color hue blobs. */
function premultGamma(
  color: OklabColor,
  alpha: number,
  space: OutputColorSpace
): [number, number, number, number] {
  const [r, g, b] = oklabToGamma(color, space);
  const a = clamp01(alpha) * color.alpha;
  return [r * a, g * a, b * a, a];
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export type HorizonWebglPhase = "active" | "failed";

interface HorizonWebglProps {
  onPhase: (phase: HorizonWebglPhase) => void;
  values: HorizonTweakValues;
}

export default function HorizonWebgl({ onPhase, values }: HorizonWebglProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const valuesRef = useRef(values);
  const onPhaseRef = useRef(onPhase);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  useEffect(() => {
    onPhaseRef.current = onPhase;
  }, [onPhase]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let rafId = 0;
    let renderer: Renderer;
    try {
      renderer = new Renderer({
        alpha: true,
        antialias: false,
        depth: false,
        dpr: 1,
        powerPreference: "low-power",
        premultipliedAlpha: true,
        stencil: false,
      });
    } catch {
      onPhaseRef.current("failed");
      return;
    }
    const gl = renderer.gl;
    const canvas = gl.canvas;

    let outputSpace: OutputColorSpace = "srgb";
    try {
      if ("drawingBufferColorSpace" in gl) {
        gl.drawingBufferColorSpace = "display-p3";
        if (gl.drawingBufferColorSpace === "display-p3") {
          outputSpace = "display-p3";
        }
      }
    } catch {
      // Color-space negotiation is best-effort; sRGB output stays correct.
    }

    let colors = readTokenColors();
    const uniforms = {
      uBackdrop: { value: oklabToGamma(colors.background, outputSpace) },
      uBleed: { value: 0 },
      uCyanColor: { value: [0, 0, 0, 0] as number[] },
      uCyanGeom: { value: [1, 1, 0, 0] as number[] },
      uGlowGeom: { value: [1, 1, 0.5, 1] as number[] },
      uGlowPose: { value: [1, 1] as number[] },
      uGlowStopPos: { value: GLOW_STOP_POSITIONS.slice() },
      uGlowStops: { value: new Float32Array(16) },
      uHuesEdge: { value: HUES_GRADIENT_EDGE },
      uHuesPose: { value: [1, 1] as number[] },
      uOutputP3: { value: outputSpace === "display-p3" ? 1 : 0 },
      uSurgeGeom: { value: [1, 1, 0.5, 1] as number[] },
      uSurgePose: { value: [1, 1] as number[] },
      uSurgeStopPos: { value: SURGE_STOP_POSITIONS.slice() },
      uSurgeStops: { value: new Float32Array(16) },
      uVioletColor: { value: [0, 0, 0, 0] as number[] },
      uVioletGeom: { value: [1, 1, 0, 0] as number[] },
    };

    let mesh: Mesh;
    try {
      const geometry = new Triangle(gl);
      const program = new Program(gl, {
        depthTest: false,
        depthWrite: false,
        fragment: FRAGMENT_SHADER,
        uniforms,
        vertex: VERTEX_SHADER,
      });
      mesh = new Mesh(gl, { geometry, program });
    } catch {
      canvas.remove();
      onPhaseRef.current("failed");
      return;
    }

    host.appendChild(canvas);

    const cssSize = { height: host.clientHeight, width: host.clientWidth };
    const resizeObserver = new ResizeObserver((observed) => {
      const entry = observed.at(-1);
      if (!entry) {
        return;
      }
      cssSize.width = entry.contentRect.width;
      cssSize.height = entry.contentRect.height;
    });
    resizeObserver.observe(host);

    const themeObserver = new MutationObserver(() => {
      colors = readTokenColors();
      uniforms.uBackdrop.value = oklabToGamma(colors.background, outputSpace);
    });
    themeObserver.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });

    const fail = () => {
      if (disposed) {
        return;
      }
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      onPhaseRef.current("failed");
    };
    const onContextLost = () => fail();
    canvas.addEventListener("webglcontextlost", onContextLost);

    const ensureSize = (scale: number): boolean => {
      const width = Math.max(1, Math.round(cssSize.width * scale));
      const height = Math.max(1, Math.round(cssSize.height * scale));
      if (cssSize.width < 1 || cssSize.height < 1) {
        return false;
      }
      if (canvas.width !== width || canvas.height !== height) {
        renderer.setSize(width, height);
        // OGL pins the element to the backing-store size; the canvas must
        // stretch to the container so `canvasScale` stays a resolution knob.
        canvas.style.width = "100%";
        canvas.style.height = "100%";
      }
      return true;
    };

    const drawFrame = (timeSec: number) => {
      const v = valuesRef.current;
      const bleed = v.bleedX / 100;
      const boxWidth = cssSize.width * (1 + 2 * bleed);
      const boxHeight = cssSize.height;

      const glow = glowPose(timeSec, v);
      const hues = huesPose(timeSec, v);
      const surge = surgePose(timeSec, v);
      const setPose = (target: number[], pose: LayerPose) => {
        target[0] = pose.scale;
        target[1] = pose.opacity;
      };
      setPose(uniforms.uGlowPose.value, glow);
      setPose(uniforms.uHuesPose.value, hues);
      setPose(uniforms.uSurgePose.value, surge);

      uniforms.uBleed.value = bleed;
      // Geometry vec4s pack [rx, ry, cx, cy] in layer-box fractions.
      uniforms.uGlowGeom.value = [
        v.glowWidth / 100,
        v.glowHeight / 100,
        0.5,
        v.glowY / 100,
      ];
      uniforms.uSurgeGeom.value = [
        v.surgeWidth / 100,
        v.surgeHeight / 100,
        0.5,
        v.surgeY / 100,
      ];
      uniforms.uGlowStops.value = stopsMatrix([
        [colors.blue400, v.glowCore / 100],
        [colors.blue500, v.glowMid / 100],
        [colors.blue600, v.glowOuter / 100],
        null,
      ]);
      uniforms.uSurgeStops.value = stopsMatrix([
        [colors.blue400, v.surgeCore / 100],
        [colors.blue600, v.surgeMid / 100],
        null,
        null,
      ]);

      // blur(30px) approximation: widen each blob by ~the blur radius and
      // dim by the area ratio so total energy stays put.
      const blurX = boxWidth > 0 ? v.huesBlur / boxWidth : 0;
      const blurY = boxHeight > 0 ? v.huesBlur / boxHeight : 0;
      const blob = (
        ellipse: { cx: number; cy: number; rx: number; ry: number },
        color: OklabColor,
        intensity: number,
        geomTarget: { value: number[] },
        colorTarget: { value: number[] }
      ) => {
        const rx = ellipse.rx + blurX;
        const ry = ellipse.ry + blurY;
        const dim = (ellipse.rx * ellipse.ry) / (rx * ry);
        geomTarget.value = [rx, ry, ellipse.cx, ellipse.cy];
        colorTarget.value = [
          ...premultGamma(color, intensity * dim, outputSpace),
        ];
      };
      blob(
        VIOLET_ELLIPSE,
        colors.violet600,
        v.huesViolet / 100,
        uniforms.uVioletGeom,
        uniforms.uVioletColor
      );
      blob(
        CYAN_ELLIPSE,
        colors.cyan400,
        v.huesCyan / 100,
        uniforms.uCyanGeom,
        uniforms.uCyanColor
      );

      renderer.render({ scene: mesh });
    };

    let startMs = -1;
    let nextDueMs = 0;
    let active = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Sleep through the inter-frame gap with a self-correcting timer and only
    // hand off to rAF inside the last few ms: every armed rAF keeps the frame
    // pipeline ticking for that vsync even when the callback draws nothing,
    // which measured nearly as expensive as drawing (~129 wakes/s ≈ +180ms/s
    // task time on a 120Hz display).
    const RAF_HANDOFF_MS = 4;
    const schedule = () => {
      if (disposed) {
        return;
      }
      const waitMs = nextDueMs - performance.now();
      if (waitMs > RAF_HANDOFF_MS) {
        timeoutId = setTimeout(
          schedule,
          Math.max(1, waitMs - RAF_HANDOFF_MS / 2)
        );
      } else {
        rafId = requestAnimationFrame(tick);
      }
    };

    /** Advances the frame clock; false when this wake-up is not due yet. */
    const advanceSchedule = (nowMs: number): boolean => {
      if (startMs < 0) {
        startMs = nowMs;
        nextDueMs = nowMs;
      }
      if (nowMs < nextDueMs - 1) {
        return false;
      }
      const fps = clamp(valuesRef.current.canvasFps, MIN_FPS, MAX_FPS);
      const minDeltaMs = 1000 / fps;
      nextDueMs += minDeltaMs;
      if (nowMs - nextDueMs > minDeltaMs) {
        nextDueMs = nowMs + minDeltaMs;
      }
      return true;
    };

    /** Renders one frame; false on a fatal draw error. */
    const renderFrame = (nowMs: number): boolean => {
      if (!ensureSize(clamp(valuesRef.current.canvasScale, MIN_SCALE, 1))) {
        return true;
      }
      try {
        drawFrame((nowMs - startMs) / 1000);
      } catch {
        return false;
      }
      if (!active) {
        active = true;
        onPhaseRef.current("active");
      }
      return true;
    };

    const tick = (nowMs: number) => {
      if (disposed) {
        return;
      }
      if (!advanceSchedule(nowMs)) {
        schedule();
        return;
      }
      if (!renderFrame(nowMs)) {
        fail();
        return;
      }
      schedule();
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div
      aria-hidden
      className={styles.horizonCanvas}
      data-slot="project-index-horizon-canvas"
      ref={hostRef}
    />
  );
}
