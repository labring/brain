import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ambientPaddingPx,
  bloomGradientStops,
  bloomScreenRect,
  CANVAS_GLASS_DOT_GAP,
  CANVAS_GLASS_SNAPSHOT_MAX_DIMENSION,
  dotGridPhase,
  formatCssSrgb,
  type GlassOklabColor,
  type GlassRect,
  type GlassSrgbColor,
  glassAmbientPlacement,
  labToSrgb,
  oklabToSrgb,
  parseResolvedCssColor,
  parseResolvedCssColorToSrgb,
  pickCaptureScale,
  screenRectToFlow,
} from "./canvas-glass-snapshot";

function region(width: number, height: number): GlassRect {
  return { height, left: 0, top: 0, width };
}

const AMBIENT_TRANSFORM_PATTERN =
  /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\((-?[\d.]+)\)/;

test("pickCaptureScale tracks zoom × dpr and caps huge sheets", () => {
  assert.equal(pickCaptureScale(region(1000, 800), 1, 2), 2);
  assert.equal(pickCaptureScale(region(1000, 800), 0.5, 1), 0.5);
  // 8192-wide sheet at scale 2 would be 16384 texture px — capped to 4096.
  assert.equal(
    pickCaptureScale(region(8192, 800), 1, 2),
    CANVAS_GLASS_SNAPSHOT_MAX_DIMENSION / 8192
  );
  // Extremely low zoom still yields a usable texture.
  assert.equal(pickCaptureScale(region(100, 100), 0.01, 1), 0.05);
});

/**
 * Mirror of xyflow's Background pattern math (see BackgroundComponent):
 * pattern x = transform.x % scaledGap, patternTransform translates by
 * -(offset·zoom || 1 + scaledGap/2), and the dot circle sits at
 * (radius, radius) inside the tile with radius = size·zoom/2.
 */
function xyflowDotScreenX(
  viewportX: number,
  zoom: number,
  tile: number
): number {
  const scaledGap = CANVAS_GLASS_DOT_GAP * zoom;
  const scaledSize = 1 * zoom;
  const scaledOffset = 0 * zoom || 1 + scaledGap / 2;
  return (
    (viewportX % scaledGap) - scaledOffset + scaledSize / 2 + tile * scaledGap
  );
}

test("dotGridPhase reproduces xyflow dot positions in flow space", () => {
  for (const zoom of [0.3, 0.5, 1, 1.2]) {
    for (const viewportX of [0, 37.5, -240.25, 1024]) {
      const phase = dotGridPhase(zoom);
      for (const tile of [0, 1, 7]) {
        const screenX = xyflowDotScreenX(viewportX, zoom, tile);
        const flowX = (screenX - viewportX) / zoom;
        const steps = (flowX - phase) / CANVAS_GLASS_DOT_GAP;
        assert.ok(
          Math.abs(steps - Math.round(steps)) < 1e-9,
          `zoom ${zoom} viewportX ${viewportX}: dot at flow ${flowX} not on grid (phase ${phase})`
        );
      }
    }
  }
});

test("bloomScreenRect keeps the 1205:784 aspect centered", () => {
  const rect = bloomScreenRect(2000, 784);
  assert.equal(rect.width, 1205);
  assert.equal(rect.height, 784);
  assert.equal(rect.left, (2000 - 1205) / 2);
  assert.equal(rect.top, 0);
});

test("screenRectToFlow inverts the viewport transform", () => {
  const flow = screenRectToFlow(
    { height: 200, left: 150, top: 90, width: 400 },
    { x: 50, y: -10, zoom: 2 }
  );
  assert.deepEqual(flow, { height: 100, left: 50, top: 50, width: 200 });
});

test("glassAmbientPlacement pins the ambient plane to screen space", () => {
  const container = { height: 720, width: 1100 };
  const padding = ambientPaddingPx(40, 1); // 120
  assert.equal(padding, 120);
  // The placement must map the padded texture's local origin to screen
  // (-padding, -padding) under sheet offset ∘ viewport transform, for any
  // viewport: screen = zoom · (sheetRect + translate + zoomInverse·p) + xy.
  for (const viewport of [
    { x: 0, y: 0, zoom: 1 },
    { x: -240.5, y: 96.25, zoom: 1 },
    { x: 37, y: -18, zoom: 0.5 },
    { x: 120, y: 80, zoom: 1.2 },
  ]) {
    const sheetRect = { left: -60, top: -72 };
    const placement = glassAmbientPlacement(
      sheetRect,
      viewport,
      container,
      padding
    );
    assert.equal(placement.width, container.width + padding * 2);
    assert.equal(placement.height, container.height + padding * 2);
    const match = placement.transform.match(AMBIENT_TRANSFORM_PATTERN);
    assert.notEqual(match, null);
    const [, tx, ty, scale] = match ?? [];
    // Local point p maps to flow (sheet + t + s·p), then to screen.
    const screenX = (point: number) =>
      viewport.zoom * (sheetRect.left + Number(tx) + Number(scale) * point) +
      viewport.x;
    const screenY = (point: number) =>
      viewport.zoom * (sheetRect.top + Number(ty) + Number(scale) * point) +
      viewport.y;
    assert.ok(Math.abs(screenX(0) - -padding) < 1e-6, `${screenX(0)}`);
    assert.ok(Math.abs(screenY(0) - -padding) < 1e-6, `${screenY(0)}`);
    assert.ok(
      Math.abs(screenX(placement.width) - (container.width + padding)) < 1e-6
    );
    assert.ok(
      Math.abs(screenY(placement.height) - (container.height + padding)) < 1e-6
    );
  }
});

test("parseResolvedCssColor handles the probe serializations", () => {
  assert.deepEqual(parseResolvedCssColor("oklab(0.5 0.1 -0.05 / 0.2)"), {
    a: 0.1,
    alpha: 0.2,
    b: -0.05,
    l: 0.5,
  });
  const oklch = parseResolvedCssColor("oklch(0.5 0.2 180 / 0.3)");
  assert.notEqual(oklch, null);
  assert.ok(Math.abs((oklch?.a ?? 0) - -0.2) < 1e-9);
  assert.ok(Math.abs(oklch?.b ?? 1) < 1e-9);
  assert.equal(oklch?.alpha, 0.3);
  assert.deepEqual(parseResolvedCssColor("transparent"), {
    a: 0,
    alpha: 0,
    b: 0,
    l: 0,
  });
  assert.equal(parseResolvedCssColor("rgb(255, 0, 0)"), null);
  assert.equal(parseResolvedCssColor("lab(50 40 59.5)"), null);
  assert.equal(parseResolvedCssColor("currentcolor"), null);
  assert.equal(parseResolvedCssColor(""), null);
});

test("parseResolvedCssColorToSrgb handles background serializations", () => {
  const red = parseResolvedCssColorToSrgb("rgb(255, 0, 0)");
  assert.deepEqual(red, { alpha: 1, blue: 0, green: 0, red: 1 });
  const srgb = parseResolvedCssColorToSrgb("color(srgb 0.1 0.2 0.3 / 0.5)");
  assert.deepEqual(srgb, { alpha: 0.5, blue: 0.3, green: 0.2, red: 0.1 });
  // lab(100 0 0) is white; lab(0 0 0) is black.
  const white = parseResolvedCssColorToSrgb("lab(100 0 0)");
  assert.notEqual(white, null);
  for (const channel of ["red", "green", "blue"] as const) {
    assert.ok(Math.abs((white?.[channel] ?? 0) - 1) < 1e-3, `${channel}`);
  }
  const black = parseResolvedCssColorToSrgb("lab(0 0 0)");
  for (const channel of ["red", "green", "blue"] as const) {
    assert.ok(Math.abs(black?.[channel] ?? 1) < 1e-6, `${channel}`);
  }
  assert.equal(parseResolvedCssColorToSrgb("color(display-p3 1 0 0)"), null);
  assert.equal(parseResolvedCssColorToSrgb(""), null);
});

test("labToSrgb round-trips a known dark neutral", () => {
  // lab(2.75381 0 0) is the canvas surface token; neutrals stay neutral.
  const color = labToSrgb(2.753_81, 0, 0, 1);
  assert.ok(Math.abs(color.red - color.green) < 1e-4);
  assert.ok(Math.abs(color.green - color.blue) < 1e-4);
  assert.ok(color.red > 0.02 && color.red < 0.05, `${color.red}`);
});

test("bloomGradientStops flattens the ramp over the background", () => {
  const background: GlassSrgbColor = {
    alpha: 1,
    blue: 0.04,
    green: 0.04,
    red: 0.04,
  };
  const glow: GlassOklabColor = { a: 0.05, alpha: 0.2, b: -0.1, l: 0.8 };
  const surface: GlassOklabColor = { a: 0, alpha: 0.2, b: 0, l: 0.15 };
  const stops = bloomGradientStops(background, glow, surface);

  // Every flattened stop is opaque — the texture never alpha-composites.
  for (const stop of stops) {
    assert.ok(stop.color.endsWith("/ 1.000000)"), stop.color);
  }

  const glowSrgb = oklabToSrgb(glow);
  const expectedFirst = formatCssSrgb({
    alpha: 1,
    blue: background.blue * 0.8 + glowSrgb.blue * 0.2,
    green: background.green * 0.8 + glowSrgb.green * 0.2,
    red: background.red * 0.8 + glowSrgb.red * 0.2,
  });
  assert.equal(stops[0]?.offset, 0);
  assert.equal(stops[0]?.color, expectedFirst);

  // The fade-out wedge ends exactly on the background color.
  const last = stops.at(-1);
  assert.equal(last?.offset, 1);
  assert.equal(last?.color, formatCssSrgb({ ...background, alpha: 1 }));

  let previousOffset = -1;
  for (const stop of stops) {
    assert.ok(stop.offset > previousOffset);
    previousOffset = stop.offset;
  }
});
