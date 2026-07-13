/**
 * Snapshot glass: pre-blurred backdrop texture for the masked glass sheet.
 *
 * Chromium keeps no cache for `backdrop-filter` output — it re-reads the live
 * framebuffer and re-blurs inside every produced frame whose damage overlaps
 * the sheet, even when the change is painted above the glass. This module
 * replaces that per-frame tax with pre-blurred textures rendered into
 * extended-sRGB float16 canvases (wide-gamut safe, see
 * GLASS_CONTEXT_SETTINGS), blurred once with `ctx.filter`, and mounted as
 * children of the masked sheet.
 *
 * The backdrop splits into two planes, because they move differently:
 *
 * - The AMBIENT plane (surface color + bloom) is screen-space — the bloom
 *   never moves while the user pans. Its texture is counter-transformed
 *   against the viewport every frame (a compositor-cheap transform write),
 *   so panning shows the glow flowing through the windows continuously,
 *   exactly like live glass, with no settle snap. It re-renders only on
 *   theme, container-size, or zoom-settle changes (the live blur radius is
 *   in flow px, so its screen-space σ scales with zoom).
 * - The CONTENT plane (dot grid + edges) is flow-space and transparent — it
 *   rides the viewport transform natively and composites over the ambient
 *   plane. It regenerates on node-geometry/edge changes (throttled during
 *   drags) and zoom settle; panning never regenerates anything.
 *
 * Splitting a blur is exact where the occluding layer's alpha is locally
 * constant and second-order small elsewhere (the bloom varies over hundreds
 * of px against a σ=40 kernel), which the equivalence guard verifies.
 * The ambient plane is also the first real "blurred twin": a future
 * animated background layer joins the same way — pre-blur once, run the
 * same transform/opacity animation on the blurred copy. Any such animation
 * must stay transform/opacity-only — content changes force a re-blur and
 * would reintroduce the per-frame cost.
 *
 * Wide gamut is load-bearing: the palette is oklch/oklab, and any 8-bit
 * sRGB intermediate clamps P3 rendering and paints a flat ≈+10 RGB veil
 * over the mask windows on P3 displays. Browsers that cannot verify a
 * float16 2d context (or lack `ctx.filter`) keep the live `backdrop-filter`
 * instead.
 */

import {
  CANVAS_GLASS_BLUR_RADIUS,
  type GlassSheetGeometry,
} from "./canvas-glass-geometry";

/** Backing-store safety cap; blurred content survives downscale losslessly. */
export const CANVAS_GLASS_SNAPSHOT_MAX_DIMENSION = 4096;

/** Mirrors `<Background gap={32}>` in canvas.tsx (flow px between dots). */
export const CANVAS_GLASS_DOT_GAP = 32;

/**
 * xyflow draws pattern dots at `size(=1) * zoom / 2` screen px, which is a
 * constant 0.5 flow px at every zoom.
 */
export const CANVAS_GLASS_DOT_RADIUS = 0.5;

/** Set on `<html>` (e.g. by test fixtures) to force live `backdrop-filter`. */
export const CANVAS_GLASS_MODE_DATASET_KEY = "canvasGlass";

/** Sheet dataset flag: present once a texture is mounted and painted. */
export const CANVAS_GLASS_SNAPSHOT_READY_ATTRIBUTE = "data-snapshot";

/** Trailing throttle for content-driven regens (node drag, edge churn). */
export const CANVAS_GLASS_REGEN_THROTTLE_MS = 160;

/** Quiet window after the last viewport change before a settle regen. */
export const CANVAS_GLASS_VIEWPORT_SETTLE_MS = 160;

export interface GlassRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface GlassViewportTransform {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Texture pixels per flow px. Tracks zoom × devicePixelRatio for a crisp
 * texture at the current view, capped so huge sheets cannot allocate
 * unbounded backing stores — the texture is fully blurred, so resolution
 * loss from the cap is invisible.
 */
export function pickCaptureScale(
  region: GlassRect,
  zoom: number,
  devicePixelRatio: number,
  maxDimension: number = CANVAS_GLASS_SNAPSHOT_MAX_DIMENSION
): number {
  const ideal = Math.max(0.05, zoom * devicePixelRatio);
  const longest = Math.max(region.width, region.height, 1);
  return Math.min(ideal, maxDimension / longest);
}

/**
 * Flow-space phase of the dot grid. xyflow offsets its SVG pattern by
 * `offset * zoom || 1 + scaledGap / 2` — with the default `offset = 0` the
 * `||` short-circuits to `1 + gap·zoom/2`, so besides the −gap/2 shift and
 * the dot radius there is a 1 *screen* px offset that is zoom-dependent in
 * flow space. Dot centers sit at `gap·k + dotGridPhase(zoom)` on both axes.
 */
export function dotGridPhase(zoom: number): number {
  return -CANVAS_GLASS_DOT_GAP / 2 + CANVAS_GLASS_DOT_RADIUS - 1 / zoom;
}

/**
 * Screen rect of `.canvas-surface::before` (the bloom): height matches the
 * container, width follows the locked 1205:784 Figma aspect, centered.
 */
export function bloomScreenRect(
  containerWidth: number,
  containerHeight: number
): GlassRect {
  const width = containerHeight * (1205 / 784);
  return {
    height: containerHeight,
    left: (containerWidth - width) / 2,
    top: 0,
    width,
  };
}

/** Map a screen-space rect into flow space under the viewport transform. */
export function screenRectToFlow(
  rect: GlassRect,
  viewport: GlassViewportTransform
): GlassRect {
  return {
    height: rect.height / viewport.zoom,
    left: (rect.left - viewport.x) / viewport.zoom,
    top: (rect.top - viewport.y) / viewport.zoom,
    width: rect.width / viewport.zoom,
  };
}

/**
 * The ambient raster extends past the container by 3σ (screen px) so the
 * blur never bleeds transparency into container-edge windows.
 */
export function ambientPaddingPx(blurRadius: number, zoom: number): number {
  return Math.ceil(blurRadius * zoom * 3);
}

export interface GlassAmbientPlacement {
  height: number;
  transform: string;
  width: number;
}

/**
 * CSS placement that pins the ambient texture to SCREEN coordinates from
 * inside the sheet: the sheet sits at flow (left, top) inside the viewport
 * transform, so inverting both per frame holds the texture still on screen
 * while the canvas pans/zooms — the property that makes the bloom flow
 * through the windows continuously instead of snapping at settle. Requires
 * `transform-origin: 0 0`. `padding` is the padding the texture was
 * RENDERED with (its σ may lag a zoom gesture until settle; invisible on a
 * smooth field).
 */
export function glassAmbientPlacement(
  sheetRect: { left: number; top: number },
  viewport: GlassViewportTransform,
  container: { height: number; width: number },
  padding: number
): GlassAmbientPlacement {
  const translateX = (-padding - viewport.x) / viewport.zoom - sheetRect.left;
  const translateY = (-padding - viewport.y) / viewport.zoom - sheetRect.top;
  return {
    height: container.height + padding * 2,
    transform: `translate(${translateX}px, ${translateY}px) scale(${1 / viewport.zoom})`,
    width: container.width + padding * 2,
  };
}

/**
 * A resolved color in OKLab — the space the bloom's `color-mix(in oklab, …)`
 * stops resolve to and the space CSS interpolates non-legacy gradient stops
 * in.
 */
export interface GlassOklabColor {
  a: number;
  alpha: number;
  b: number;
  l: number;
}

/** Gamma-encoded sRGB, 0..1 (out-of-gamut values pass through unclamped). */
export interface GlassSrgbColor {
  alpha: number;
  blue: number;
  green: number;
  red: number;
}

function linearChannelToSrgb(channel: number): number {
  const sign = channel < 0 ? -1 : 1;
  const magnitude = Math.abs(channel);
  return (
    sign *
    (magnitude <= 0.003_130_8
      ? magnitude * 12.92
      : 1.055 * magnitude ** (1 / 2.4) - 0.055)
  );
}

export function oklabToSrgb(color: GlassOklabColor): GlassSrgbColor {
  const l_ = color.l + 0.396_337_777_4 * color.a + 0.215_803_757_3 * color.b;
  const m_ = color.l - 0.105_561_345_8 * color.a - 0.063_854_172_8 * color.b;
  const s_ = color.l - 0.089_484_177_5 * color.a - 1.291_485_548 * color.b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return {
    alpha: color.alpha,
    blue: linearChannelToSrgb(
      -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s
    ),
    green: linearChannelToSrgb(
      -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s
    ),
    red: linearChannelToSrgb(
      4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s
    ),
  };
}

/** CIELAB (D50, as computed styles serialize it) → gamma sRGB (D65). */
export function labToSrgb(
  l: number,
  aStar: number,
  bStar: number,
  alpha: number
): GlassSrgbColor {
  const fy = (l + 16) / 116;
  const fx = fy + aStar / 500;
  const fz = fy - bStar / 200;
  const epsilon = 216 / 24_389;
  const kappa = 24_389 / 27;
  const fInverse = (t: number) => {
    const cubed = t ** 3;
    return cubed > epsilon ? cubed : (116 * t - 16) / kappa;
  };
  // D50 white point.
  const x = fInverse(fx) * 0.964_22;
  const y = (l > kappa * epsilon ? fy ** 3 : l / kappa) * 1;
  const z = fInverse(fz) * 0.825_21;
  // Bradford D50→D65, then XYZ→linear sRGB (both from CSS Color 4).
  const xd =
    0.955_473_452_704 * x - 0.023_098_536_874 * y + 0.063_259_308_661 * z;
  const yd =
    -0.028_369_706_963 * x + 1.009_995_458_006 * y + 0.021_041_398_967 * z;
  const zd =
    0.012_314_001_688 * x - 0.020_507_696_433 * y + 1.330_365_936_608 * z;
  return {
    alpha,
    blue: linearChannelToSrgb(
      0.055_630_079_697 * xd - 0.203_976_958_889 * yd + 1.056_971_514_243 * zd
    ),
    green: linearChannelToSrgb(
      -0.969_243_636_281 * xd + 1.875_967_501_508 * yd + 0.041_555_057_407 * zd
    ),
    red: linearChannelToSrgb(
      3.240_969_941_905 * xd - 1.537_383_177_57 * yd - 0.498_610_760_293 * zd
    ),
  };
}

const NUMBER_PATTERN = /-?\d*\.?\d+(?:e-?\d+)?%?/gi;

function parseColorComponents(body: string): number[] {
  const matches = body.replace(/\bnone\b/gi, "0").match(NUMBER_PATTERN);
  if (matches == null) {
    return [];
  }
  return matches.map((token) =>
    token.endsWith("%")
      ? Number.parseFloat(token) / 100
      : Number.parseFloat(token)
  );
}

/**
 * Parse the resolved serializations computed background colors take in this
 * codebase (`lab()` for the tailwind token pipeline, legacy `rgb()/rgba()`,
 * `color(srgb …)`) into gamma sRGB for the bloom flattening blend. Unknown
 * syntax returns null and the caller keeps live glass.
 */
function srgbFromParts(parts: number[], scale: number): GlassSrgbColor {
  return {
    alpha: parts[3] ?? 1,
    blue: (parts[2] ?? 0) * scale,
    green: (parts[1] ?? 0) * scale,
    red: (parts[0] ?? 0) * scale,
  };
}

export function parseResolvedCssColorToSrgb(
  input: string
): GlassSrgbColor | null {
  const text = input.trim().toLowerCase();
  const open = text.indexOf("(");
  if (open === -1 || !text.endsWith(")")) {
    return text === "transparent"
      ? { alpha: 0, blue: 0, green: 0, red: 0 }
      : null;
  }
  const name = text.slice(0, open).trim();
  const body = text.slice(open + 1, -1);
  const parts = parseColorComponents(body);
  if (parts.length < 3) {
    return null;
  }
  switch (name) {
    case "rgb":
    case "rgba":
      // Percentages already divided by 100; bare channels are 0..255.
      return srgbFromParts(parts, body.includes("%") ? 1 : 1 / 255);
    case "color":
      return body.trim().startsWith("srgb ") ? srgbFromParts(parts, 1) : null;
    case "lab":
      // Computed lab() serializes L as a number 0..100.
      return labToSrgb(
        parts[0] ?? 0,
        parts[1] ?? 0,
        parts[2] ?? 0,
        parts[3] ?? 1
      );
    case "oklab":
    case "oklch": {
      const oklab = parseResolvedCssColor(text);
      return oklab == null ? null : oklabToSrgb(oklab);
    }
    default:
      return null;
  }
}

/**
 * Parse the resolved serializations the bloom-stop probes produce:
 * `color-mix(in oklab, …)` computes to `oklab()`, plus `oklch()` and legacy
 * `rgb()/rgba()` (treated as near-enough via no conversion — the probes
 * never produce them for this palette, but a plain-color theme could).
 * Unknown syntax returns null and the caller keeps live glass.
 */
export function parseResolvedCssColor(input: string): GlassOklabColor | null {
  const text = input.trim().toLowerCase();
  const open = text.indexOf("(");
  if (open === -1 || !text.endsWith(")")) {
    return text === "transparent" ? { a: 0, alpha: 0, b: 0, l: 0 } : null;
  }
  const name = text.slice(0, open).trim();
  const parts = parseColorComponents(text.slice(open + 1, -1));
  if (parts.length < 3) {
    return null;
  }
  if (name === "oklab") {
    return {
      a: parts[1] ?? 0,
      alpha: parts[3] ?? 1,
      b: parts[2] ?? 0,
      l: parts[0] ?? 0,
    };
  }
  if (name === "oklch") {
    const chroma = parts[1] ?? 0;
    const hueRadians = ((parts[2] ?? 0) * Math.PI) / 180;
    return {
      a: chroma * Math.cos(hueRadians),
      alpha: parts[3] ?? 1,
      b: chroma * Math.sin(hueRadians),
      l: parts[0] ?? 0,
    };
  }
  return null;
}

export function formatCssSrgb(color: GlassSrgbColor): string {
  const clampAlpha = Math.min(1, Math.max(0, color.alpha));
  return `color(srgb ${color.red.toFixed(6)} ${color.green.toFixed(6)} ${color.blue.toFixed(6)} / ${clampAlpha.toFixed(6)})`;
}

export interface GlassGradientStop {
  color: string;
  offset: number;
}

/**
 * Samples across the 0%→95% main ramp. Canvas interpolates between stops in
 * the canvas color space rather than CSS's OKLab path, so the ramp is
 * resampled densely; per-segment curvature error shrinks ∝ 1/N². 192 keeps
 * the worst channel comfortably under the 0.3/255 equivalence bar and costs
 * nothing measurable (one gradient build per regeneration).
 */
const BLOOM_RAMP_SAMPLES = 192;

/** Extra samples across the 95%→100% fade-out wedge. */
const BLOOM_WEDGE_SAMPLES = 4;

function blendOverBackground(
  background: GlassSrgbColor,
  color: GlassSrgbColor
): GlassSrgbColor {
  const alpha = Math.min(1, Math.max(0, color.alpha));
  return {
    alpha: 1,
    blue: background.blue * (1 - alpha) + color.blue * alpha,
    green: background.green * (1 - alpha) + color.green * alpha,
    red: background.red * (1 - alpha) + color.red * alpha,
  };
}

/**
 * Rebuild the bloom's CSS gradient as canvas stops, pre-flattened over the
 * surface background so the texture never alpha-composites the bloom
 * itself. This is load-bearing for equivalence: Blink rasterizes the page's
 * `::before`-over-background blend in gamma sRGB tiles, while canvas 2d
 * blends in the canvas color space (display-p3) — the same translucent
 * layers measured a flat ≈1/255 red bias when composited in-canvas.
 * Sampling the CSS ramp in OKLab (its interpolation space), converting each
 * sample to sRGB, and blending there reproduces Blink's arithmetic; the
 * opaque stops then convert to P3 losslessly. The ramp holds alpha constant
 * (both mixes carry 20%), so premultiplied and straight interpolation
 * agree; the fade-out wedge is sampled explicitly.
 */
export function bloomGradientStops(
  background: GlassSrgbColor,
  glowMix: GlassOklabColor,
  surfaceMix: GlassOklabColor
): GlassGradientStop[] {
  const stops: GlassGradientStop[] = [];
  for (let index = 0; index <= BLOOM_RAMP_SAMPLES; index += 1) {
    const t = index / BLOOM_RAMP_SAMPLES;
    const sample = oklabToSrgb({
      a: glowMix.a + (surfaceMix.a - glowMix.a) * t,
      alpha: glowMix.alpha + (surfaceMix.alpha - glowMix.alpha) * t,
      b: glowMix.b + (surfaceMix.b - glowMix.b) * t,
      l: glowMix.l + (surfaceMix.l - glowMix.l) * t,
    });
    stops.push({
      color: formatCssSrgb(blendOverBackground(background, sample)),
      offset: 0.95 * t,
    });
  }
  const surfaceSrgb = oklabToSrgb(surfaceMix);
  for (let index = 1; index <= BLOOM_WEDGE_SAMPLES; index += 1) {
    const t = index / BLOOM_WEDGE_SAMPLES;
    stops.push({
      color: formatCssSrgb(
        blendOverBackground(background, {
          ...surfaceSrgb,
          alpha: surfaceMix.alpha * (1 - t),
        })
      ),
      offset: 0.95 + 0.05 * t,
    });
  }
  return stops;
}

export interface GlassEdgeStroke {
  d: string;
  dashArray: number[];
  lineCap: CanvasLineCap;
  opacity: number;
  stroke: string;
  strokeWidth: number;
}

export interface GlassBackdropTheme {
  /** Resolved `color-mix(in oklab, glow 20%, transparent)` bloom stop. */
  bloomGlowMix: GlassOklabColor;
  /** Resolved `color-mix(in oklab, surface 20%, transparent)` bloom stop. */
  bloomSurfaceMix: GlassOklabColor;
  /** Resolved fill of the xyflow dot pattern; null hides the dots layer. */
  dotFill: string | null;
  /** Resolved `.canvas-surface` background color. */
  surfaceColor: string;
  /** The surface color parsed to sRGB for the bloom flattening blend. */
  surfaceSrgb: GlassSrgbColor;
}

/**
 * Same color-mix expressions as `.canvas-surface::before` in canvas.css.
 * Resolved through a probe element so the browser owns the oklab math and
 * theme/token indirection.
 */
const BLOOM_GLOW_MIX_EXPRESSION =
  "color-mix(in oklab, var(--color-canvas-glow) 20%, transparent)";
const BLOOM_SURFACE_MIX_EXPRESSION =
  "color-mix(in oklab, var(--color-canvas-surface) 20%, transparent)";

/**
 * Read every themable backdrop color from the live DOM. Returns null when a
 * color fails to resolve or parse — callers keep live glass instead of
 * rendering wrong colors.
 */
export function readGlassBackdropTheme(
  surface: HTMLElement
): GlassBackdropTheme | null {
  const document_ = surface.ownerDocument;
  const view = document_.defaultView;
  if (view == null) {
    return null;
  }
  const surfaceColor = view.getComputedStyle(surface).backgroundColor;

  const probe = document_.createElement("span");
  probe.style.display = "none";
  surface.append(probe);
  probe.style.color = BLOOM_GLOW_MIX_EXPRESSION;
  const glowResolved = view.getComputedStyle(probe).color;
  probe.style.color = BLOOM_SURFACE_MIX_EXPRESSION;
  const surfaceMixResolved = view.getComputedStyle(probe).color;
  probe.remove();

  const bloomGlowMix = parseResolvedCssColor(glowResolved);
  const bloomSurfaceMix = parseResolvedCssColor(surfaceMixResolved);
  const surfaceSrgb = parseResolvedCssColorToSrgb(surfaceColor);
  if (bloomGlowMix == null || bloomSurfaceMix == null || surfaceSrgb == null) {
    return null;
  }

  const dot = surface.querySelector(".react-flow__background circle");
  const dotFill = dot == null ? null : view.getComputedStyle(dot).fill;

  return {
    bloomGlowMix,
    bloomSurfaceMix,
    dotFill: dotFill === "" ? null : dotFill,
    surfaceColor,
    surfaceSrgb,
  };
}

const DASH_SEGMENT_PATTERN = /-?\d*\.?\d+/g;

function parseDashArray(serialized: string): number[] {
  if (serialized === "" || serialized === "none") {
    return [];
  }
  const matches = serialized.match(DASH_SEGMENT_PATTERN);
  if (matches == null) {
    return [];
  }
  return matches.map((token) => Number.parseFloat(token));
}

/**
 * Read the painted edge paths (flow coordinates) with their computed stroke
 * styling. The DOM is the source of truth — whatever xyflow painted below
 * the sheet is what the texture must reproduce.
 */
export function collectGlassEdgeStrokes(
  surface: HTMLElement
): GlassEdgeStroke[] {
  const view = surface.ownerDocument.defaultView;
  if (view == null) {
    return [];
  }
  const paths = surface.querySelectorAll<SVGPathElement>(
    ".react-flow__edges .react-flow__edge-path"
  );
  const strokes: GlassEdgeStroke[] = [];
  for (const path of paths) {
    const d = path.getAttribute("d");
    if (d == null || d === "") {
      continue;
    }
    const style = view.getComputedStyle(path);
    if (style.stroke === "none" || style.display === "none") {
      continue;
    }
    const opacity =
      Number.parseFloat(style.opacity || "1") *
      Number.parseFloat(style.strokeOpacity || "1");
    if (!(opacity > 0)) {
      continue;
    }
    strokes.push({
      d,
      dashArray: parseDashArray(style.strokeDasharray),
      lineCap: (style.strokeLinecap as CanvasLineCap) || "butt",
      opacity: Math.min(1, opacity),
      stroke: style.stroke,
      strokeWidth: Number.parseFloat(style.strokeWidth || "1"),
    });
  }
  return strokes;
}

/** Input for the flow-space content plane (dots + edges, transparent). */
export interface GlassContentInput {
  /** Blur radius in flow px (the sheet's `--canvas-glass-blur-radius`). */
  blurRadius: number;
  edges: GlassEdgeStroke[];
  /** Flow-space rect the texture covers (the sheet rect). */
  region: GlassRect;
  /** Texture px per flow px. */
  scale: number;
  theme: GlassBackdropTheme;
  /** Dot-grid phase depends on zoom (xyflow's 1-screen-px offset quirk). */
  zoom: number;
}

/** Input for the screen-space ambient plane (surface color + bloom). */
export interface GlassAmbientInput {
  /** Blur radius in flow px; the baked screen-space σ is `blurRadius·zoom`. */
  blurRadius: number;
  container: { height: number; width: number };
  /** Raster px per screen px. */
  scale: number;
  theme: GlassBackdropTheme;
  zoom: number;
}

/**
 * The sheet's live blur is `blur(var(--canvas-glass-blur-radius, 40px))` —
 * the texture must follow the same custom property, not the constant, so a
 * themed override keeps both pipelines in sync.
 */
export function readGlassBlurRadius(sheet: HTMLElement): number {
  const view = sheet.ownerDocument.defaultView;
  if (view == null) {
    return CANVAS_GLASS_BLUR_RADIUS;
  }
  const raw = view
    .getComputedStyle(sheet)
    .getPropertyValue("--canvas-glass-blur-radius");
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : CANVAS_GLASS_BLUR_RADIUS;
}

export interface GlassBackdropLayer {
  draw(context: CanvasRenderingContext2D, input: GlassContentInput): void;
  kind: "dots" | "edges";
}

/**
 * Paint the ambient plane in SCREEN coordinates (origin = container top
 * left): surface color across the padded raster, bloom gradient at its
 * fixed screen rect. Background fill and bloom stops share one numeric
 * source, so the gradient's fade-out edge is seamless.
 */
function fillGlassAmbientScene(
  context: CanvasRenderingContext2D,
  input: GlassAmbientInput,
  padding: number
): void {
  context.fillStyle = formatCssSrgb(input.theme.surfaceSrgb);
  context.fillRect(
    -padding,
    -padding,
    input.container.width + padding * 2,
    input.container.height + padding * 2
  );

  const rect = bloomScreenRect(input.container.width, input.container.height);
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const stops = bloomGradientStops(
    input.theme.surfaceSrgb,
    input.theme.bloomGlowMix,
    input.theme.bloomSurfaceMix
  );
  context.save();
  context.translate(rect.left + rect.width / 2, rect.top + rect.height / 2);
  context.scale(rect.width / 2, rect.height / 2);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const stop of stops) {
    gradient.addColorStop(stop.offset, stop.color);
  }
  context.fillStyle = gradient;
  context.fillRect(-1, -1, 2, 2);
  context.restore();
}

function drawDotsLayer(
  context: CanvasRenderingContext2D,
  input: GlassContentInput
): void {
  const fill = input.theme.dotFill;
  if (fill == null) {
    return;
  }
  const { region } = input;
  const phase = dotGridPhase(input.zoom);
  const gap = CANVAS_GLASS_DOT_GAP;
  const radius = CANVAS_GLASS_DOT_RADIUS;
  const firstColumn = Math.floor((region.left - radius - phase) / gap);
  const lastColumn = Math.ceil(
    (region.left + region.width + radius - phase) / gap
  );
  const firstRow = Math.floor((region.top - radius - phase) / gap);
  const lastRow = Math.ceil(
    (region.top + region.height + radius - phase) / gap
  );
  // Blink rasterizes the xyflow pattern's tiny dot (r ≤ ~1 device px) at
  // full pixel coverage — a filled square — while canvas arc() applies true
  // geometric antialiasing (~0.6 coverage), which measured as a uniform
  // ≈0.3/255 energy deficit after the blur. Match Blink's snap for small
  // device radii; real circles only once they are big enough to have a
  // visible shape.
  const deviceRadius = radius * input.scale;
  const drawAsSquare = deviceRadius <= 2;
  context.fillStyle = fill;
  context.beginPath();
  for (let row = firstRow; row <= lastRow; row += 1) {
    const cy = row * gap + phase;
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const cx = column * gap + phase;
      if (drawAsSquare) {
        context.rect(cx - radius, cy - radius, radius * 2, radius * 2);
      } else {
        context.moveTo(cx + radius, cy);
        context.arc(cx, cy, radius, 0, Math.PI * 2);
      }
    }
  }
  context.fill();
}

function drawEdgesLayer(
  context: CanvasRenderingContext2D,
  input: GlassContentInput
): void {
  for (const edge of input.edges) {
    context.save();
    context.globalAlpha = edge.opacity;
    context.lineCap = edge.lineCap;
    context.lineWidth = edge.strokeWidth;
    context.setLineDash(edge.dashArray);
    context.strokeStyle = edge.stroke;
    context.stroke(new Path2D(edge.d));
    context.restore();
  }
}

/**
 * The ordered flow-space content plane, bottom to top. Together with the
 * ambient plane this is the composable seam a future animated background
 * layer (blurred twin) slots into — the ambient plane is already the first
 * twin, animated by the identity transform.
 */
export function buildGlassContentLayers(): GlassBackdropLayer[] {
  return [
    { draw: drawDotsLayer, kind: "dots" },
    { draw: drawEdgesLayer, kind: "edges" },
  ];
}

/**
 * Both settings are equivalence-load-bearing, matched to how Blink rasters
 * the page itself:
 *
 * - `colorSpace: "srgb"` because Blink rasterizes the backdrop's tiles in
 *   gamma sRGB — alpha compositing and stroke antialiasing blend THERE. A
 *   display-p3 canvas blends in gamma P3 instead, which measured as flat
 *   ≈0.3–1/255 shifts in bloom- and edge-heavy windows.
 * - `colorType: "float16"` for two reasons: it removes per-draw unorm8
 *   quantization (locally-constant rounding over smooth fields ≈ another
 *   0.5/255 flat veil), and it makes the sRGB canvas EXTENDED sRGB — wide
 *   gamut values survive as out-of-[0,1] floats instead of clamping (the
 *   original P3 “+10 RGB veil” failure mode of 8-bit sRGB intermediates).
 *
 * Support is verified in detectGlassSnapshotSupport; browsers without
 * float16 canvases keep live backdrop-filter.
 */
const GLASS_CONTEXT_SETTINGS = {
  colorSpace: "srgb",
  colorType: "float16",
} as CanvasRenderingContext2DSettings;

function createGlassContext(
  document_: Document,
  width: number,
  height: number
): CanvasRenderingContext2D | null {
  const canvas = document_.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext("2d", GLASS_CONTEXT_SETTINGS);
}

function blurSceneIntoTarget(
  target: HTMLCanvasElement,
  scene: HTMLCanvasElement,
  width: number,
  height: number,
  blurPx: number
): boolean {
  target.width = width;
  target.height = height;
  const targetContext = target.getContext("2d", GLASS_CONTEXT_SETTINGS);
  if (targetContext == null) {
    return false;
  }
  if (blurPx > 0) {
    targetContext.filter = `blur(${blurPx}px)`;
    if (targetContext.filter === "none") {
      return false;
    }
  }
  targetContext.drawImage(scene, 0, 0);
  return true;
}

/**
 * Render the transparent flow-space content plane (dots + edges) and blur
 * it once into `target`. The blur radius is in flow units (the sheet lives
 * inside the viewport transform, so its CSS px are flow px), converted to
 * texture px by the capture scale.
 */
export function renderGlassContent(
  target: HTMLCanvasElement,
  input: GlassContentInput
): boolean {
  const width = Math.max(1, Math.round(input.region.width * input.scale));
  const height = Math.max(1, Math.round(input.region.height * input.scale));
  const document_ = target.ownerDocument;

  const sceneContext = createGlassContext(document_, width, height);
  if (sceneContext == null) {
    return false;
  }
  sceneContext.setTransform(
    input.scale,
    0,
    0,
    input.scale,
    -input.region.left * input.scale,
    -input.region.top * input.scale
  );
  for (const layer of buildGlassContentLayers()) {
    layer.draw(sceneContext, input);
  }

  return blurSceneIntoTarget(
    target,
    sceneContext.canvas,
    width,
    height,
    input.blurRadius * input.scale
  );
}

/**
 * Render the opaque screen-space ambient plane (surface color + bloom),
 * padded by 3σ, and blur it once into `target`. The live blur is declared
 * in flow px on the sheet, so the baked screen-space σ is `blurRadius·zoom`
 * — the ambient plane re-renders on zoom settle for this reason alone.
 */
export function renderGlassAmbient(
  target: HTMLCanvasElement,
  input: GlassAmbientInput
): boolean {
  const padding = ambientPaddingPx(input.blurRadius, input.zoom);
  const cssWidth = input.container.width + padding * 2;
  const cssHeight = input.container.height + padding * 2;
  const width = Math.max(1, Math.round(cssWidth * input.scale));
  const height = Math.max(1, Math.round(cssHeight * input.scale));
  const document_ = target.ownerDocument;

  const sceneContext = createGlassContext(document_, width, height);
  if (sceneContext == null) {
    return false;
  }
  sceneContext.setTransform(
    input.scale,
    0,
    0,
    input.scale,
    padding * input.scale,
    padding * input.scale
  );
  fillGlassAmbientScene(sceneContext, input, padding);

  return blurSceneIntoTarget(
    target,
    sceneContext.canvas,
    width,
    height,
    input.blurRadius * input.zoom * input.scale
  );
}

/**
 * Snapshot glass needs a verified float16 2d context (an unorm8 sRGB canvas
 * would clamp the oklch palette into a visible veil — see
 * GLASS_CONTEXT_SETTINGS) and `ctx.filter`. Anything else keeps live
 * `backdrop-filter`.
 */
export function detectGlassSnapshotSupport(document_: Document): boolean {
  if (typeof Path2D !== "function") {
    return false;
  }
  try {
    const canvas = document_.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", GLASS_CONTEXT_SETTINGS);
    if (context == null) {
      return false;
    }
    const attributes = context.getContextAttributes?.() as
      | { colorType?: string }
      | undefined;
    if (attributes?.colorType !== "float16") {
      return false;
    }
    context.filter = "blur(2px)";
    return context.filter !== "none";
  } catch {
    return false;
  }
}

/** Per-frame facts the sheet sync feeds the controller (cheap to diff). */
export interface GlassSnapshotFrame {
  edges: unknown;
  geometry: GlassSheetGeometry | null;
  height: number;
  transform: readonly [number, number, number];
  width: number;
}

export interface GlassSnapshotController {
  dispose(): void;
  observe(frame: GlassSnapshotFrame): void;
}

export interface CreateGlassSnapshotControllerOptions {
  sheet: HTMLElement;
  surface: HTMLElement;
}

/**
 * Owns the two mounted texture canvases (screen-space ambient below,
 * flow-space content above): watches the per-frame facts for input changes,
 * regenerates on a trailing throttle (content changes during drags) or
 * settle debounce (zoom / container), re-reads theme colors on `<html>`
 * attribute mutations, keeps the content canvas pinned to its captured flow
 * rect, and re-pins the ambient canvas to screen coordinates on every
 * viewport change — panning re-pins but never regenerates.
 */
export function createGlassSnapshotController({
  sheet,
  surface,
}: CreateGlassSnapshotControllerOptions): GlassSnapshotController {
  const document_ = sheet.ownerDocument;
  const view = document_.defaultView;

  // Ambient below, content above — matching the live paint order.
  const ambient = document_.createElement("canvas");
  ambient.className = "canvas-glass-sheet-ambient";
  const texture = document_.createElement("canvas");
  texture.className = "canvas-glass-sheet-texture";
  sheet.append(ambient, texture);

  let disposed = false;
  let frame: GlassSnapshotFrame | null = null;
  let captured: GlassRect | null = null;
  let ambientKey = "";
  let ambientReady = false;
  let ambientPadding = 0;
  let ambientContainer = { height: 0, width: 0 };
  let lastGeometry: GlassSheetGeometry | null = null;
  let lastEdges: unknown = null;
  let lastTransform: readonly [number, number, number] | null = null;
  let lastRegenAt = Number.NEGATIVE_INFINITY;
  let throttleDueAt: number | null = null;
  let settleDueAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let raf = 0;
  let hiddenPending = false;

  const now = () => performance.now();

  const positionTexture = (geometry: GlassSheetGeometry) => {
    if (captured == null) {
      return;
    }
    texture.style.left = `${captured.left - geometry.left}px`;
    texture.style.top = `${captured.top - geometry.top}px`;
    texture.style.width = `${captured.width}px`;
    texture.style.height = `${captured.height}px`;
  };

  const placeAmbient = (
    geometry: GlassSheetGeometry,
    transform: readonly [number, number, number]
  ) => {
    if (!ambientReady) {
      return;
    }
    const [x, y, zoom] = transform;
    const placement = glassAmbientPlacement(
      geometry,
      { x, y, zoom },
      ambientContainer,
      ambientPadding
    );
    ambient.style.width = `${placement.width}px`;
    ambient.style.height = `${placement.height}px`;
    ambient.style.transform = placement.transform;
  };

  const regenerate = () => {
    raf = 0;
    if (disposed || frame == null || frame.geometry == null) {
      return;
    }
    if (document_.visibilityState === "hidden") {
      hiddenPending = true;
      return;
    }
    const geometry = frame.geometry;
    const region: GlassRect = {
      height: geometry.height,
      left: geometry.left,
      top: geometry.top,
      width: geometry.width,
    };
    const zoom = frame.transform[2];
    const theme = readGlassBackdropTheme(surface);
    if (theme == null) {
      return;
    }
    const blurRadius = readGlassBlurRadius(sheet);
    const devicePixelRatio = view?.devicePixelRatio ?? 1;

    const ambientScale = Math.min(2, devicePixelRatio);
    const glow = theme.bloomGlowMix;
    const mix = theme.bloomSurfaceMix;
    const nextAmbientKey = `${theme.surfaceColor}|${glow.l},${glow.a},${glow.b},${glow.alpha}|${mix.l},${mix.a},${mix.b},${mix.alpha}|${frame.width}x${frame.height}|${zoom}|${blurRadius}|${ambientScale}`;
    if (nextAmbientKey !== ambientKey) {
      const ambientRendered = renderGlassAmbient(ambient, {
        blurRadius,
        container: { height: frame.height, width: frame.width },
        scale: ambientScale,
        theme,
        zoom,
      });
      if (!ambientRendered) {
        ambientReady = false;
        return;
      }
      ambientKey = nextAmbientKey;
      ambientReady = true;
      ambientPadding = ambientPaddingPx(blurRadius, zoom);
      ambientContainer = { height: frame.height, width: frame.width };
    }

    const scale = pickCaptureScale(region, zoom, devicePixelRatio);
    const rendered = renderGlassContent(texture, {
      blurRadius,
      edges: collectGlassEdgeStrokes(surface),
      region,
      scale,
      theme,
      zoom,
    });
    if (!rendered) {
      return;
    }
    captured = region;
    lastRegenAt = now();
    throttleDueAt = null;
    settleDueAt = null;
    positionTexture(geometry);
    placeAmbient(geometry, frame.transform);
    sheet.setAttribute(CANVAS_GLASS_SNAPSHOT_READY_ATTRIBUTE, "ready");
    // Observable regen counter for tests and DevTools spelunking.
    texture.dataset.regens = String(Number(texture.dataset.regens ?? "0") + 1);
  };

  const armTimer = () => {
    if (disposed) {
      return;
    }
    const dueAt = throttleDueAt ?? settleDueAt;
    if (dueAt == null) {
      return;
    }
    if (timer != null) {
      clearTimeout(timer);
    }
    timer = setTimeout(
      () => {
        timer = null;
        const stillDue = throttleDueAt ?? settleDueAt;
        if (stillDue == null) {
          return;
        }
        if (stillDue > now()) {
          armTimer();
          return;
        }
        if (raf === 0) {
          raf = view?.requestAnimationFrame(regenerate) ?? 0;
          if (raf === 0) {
            regenerate();
          }
        }
      },
      Math.max(0, dueAt - now())
    );
  };

  const scheduleContentRegen = (delay = CANVAS_GLASS_REGEN_THROTTLE_MS) => {
    const dueAt = Math.max(now(), lastRegenAt + delay);
    if (throttleDueAt == null || dueAt < throttleDueAt) {
      throttleDueAt = dueAt;
    }
    armTimer();
  };

  const scheduleSettleRegen = () => {
    settleDueAt = now() + CANVAS_GLASS_VIEWPORT_SETTLE_MS;
    armTimer();
  };

  const themeObserver = new MutationObserver(() => {
    scheduleContentRegen(0);
  });
  themeObserver.observe(document_.documentElement, {
    attributeFilter: ["class", "data-theme", "style"],
    attributes: true,
  });

  const handleVisibility = () => {
    if (document_.visibilityState === "visible" && hiddenPending) {
      hiddenPending = false;
      scheduleContentRegen(0);
    }
  };
  document_.addEventListener("visibilitychange", handleVisibility);

  return {
    dispose() {
      disposed = true;
      themeObserver.disconnect();
      document_.removeEventListener("visibilitychange", handleVisibility);
      if (timer != null) {
        clearTimeout(timer);
      }
      if (raf !== 0) {
        view?.cancelAnimationFrame(raf);
      }
      ambient.remove();
      texture.remove();
      sheet.removeAttribute(CANVAS_GLASS_SNAPSHOT_READY_ATTRIBUTE);
    },
    observe(nextFrame) {
      if (disposed) {
        return;
      }
      const previous = frame;
      frame = nextFrame;
      const geometry = nextFrame.geometry;
      const transform = nextFrame.transform;

      if (geometry == null) {
        lastGeometry = null;
        lastEdges = nextFrame.edges;
        lastTransform = transform;
        return;
      }

      const geometryChanged = geometry !== lastGeometry;
      const transformChanged =
        lastTransform == null ||
        transform[0] !== lastTransform[0] ||
        transform[1] !== lastTransform[1] ||
        transform[2] !== lastTransform[2];
      const zoomChanged =
        lastTransform != null && transform[2] !== lastTransform[2];

      if (geometryChanged) {
        if (captured == null) {
          // First activation: render before the next paint, no throttle.
          scheduleContentRegen(0);
        } else {
          positionTexture(geometry);
          scheduleContentRegen();
        }
        lastGeometry = geometry;
      }
      if (previous != null && nextFrame.edges !== lastEdges) {
        scheduleContentRegen();
      }
      lastEdges = nextFrame.edges;

      // Panning regenerates nothing: the flow-space content rides the
      // viewport transform and the screen-space ambient is only re-pinned.
      // Zoom changes the content resolution, the dot phase, and the
      // ambient's baked σ — regenerate after the gesture settles.
      if (zoomChanged) {
        scheduleSettleRegen();
      }
      if (transformChanged || geometryChanged) {
        placeAmbient(geometry, transform);
      }
      lastTransform = transform;

      if (
        previous != null &&
        (previous.width !== nextFrame.width ||
          previous.height !== nextFrame.height)
      ) {
        scheduleSettleRegen();
      }
    },
  };
}
