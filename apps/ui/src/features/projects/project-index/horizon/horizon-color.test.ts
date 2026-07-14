import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  type OklabColor,
  oklabToGamma,
  oklabToLinearSrgb,
  parseCssColorToOklab,
  srgbToOklab,
} from "./horizon-color";

const BLACK: OklabColor = { a: 0, alpha: 1, b: 0, l: 0 };

const assertClose = (actual: number, expected: number, tolerance: number) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} ≈ ${expected} (±${tolerance})`
  );
};

const assertVecClose = (
  actual: readonly number[],
  expected: readonly number[],
  tolerance: number
) => {
  assert.strictEqual(actual.length, expected.length);
  expected.forEach((value, i) => {
    assertClose(actual[i] ?? Number.NaN, value, tolerance);
  });
};

describe("oklab conversions", () => {
  test("round-trips sRGB colors", () => {
    const samples: [number, number, number][] = [
      [1, 1, 1],
      [0, 0, 0],
      [1, 0, 0],
      [0.376, 0.647, 0.98], // ~#60a5fa
      [0.13, 0.13, 0.13],
    ];
    for (const [r, g, b] of samples) {
      assertVecClose(
        oklabToGamma(srgbToOklab(r, g, b), "srgb"),
        [r, g, b],
        1e-4
      );
    }
  });

  test("white and near-black anchors match browser-resolved values", () => {
    const white = parseCssColorToOklab("oklch(1 0 0)") ?? BLACK;
    assertVecClose(oklabToGamma(white, "srgb"), [1, 1, 1], 1e-3);

    // --background dark token; browsers resolve it to ~#0a0a0a.
    const bg = parseCssColorToOklab("oklch(0.145 0 0)") ?? BLACK;
    assertVecClose(oklabToGamma(bg, "srgb"), [0.0394, 0.0394, 0.0394], 0.004);
  });

  test("keeps neutral grays neutral through P3 conversion", () => {
    const gray = parseCssColorToOklab("oklch(0.5 0 0)") ?? BLACK;
    const [r, g, b] = oklabToGamma(gray, "display-p3");
    assertClose(r, g, 1e-4);
    assertClose(g, b, 1e-4);
  });

  test("out-of-gamut oklab clamps instead of wrapping", () => {
    const vivid = parseCssColorToOklab("oklch(0.7 0.4 30)") ?? BLACK;
    assert.ok(Math.min(...oklabToLinearSrgb(vivid)) < 0);
    for (const channel of oklabToGamma(vivid, "srgb")) {
      assert.ok(channel >= 0 && channel <= 1);
    }
  });
});

describe("parseCssColorToOklab", () => {
  test("parses hex and rgb() to the same color", () => {
    const hex = parseCssColorToOklab("#60a5fa") ?? BLACK;
    const rgb = parseCssColorToOklab("rgb(96, 165, 250)") ?? BLACK;
    assertVecClose([hex.l, hex.a, hex.b], [rgb.l, rgb.a, rgb.b], 1e-6);
    assert.strictEqual(hex.alpha, 1);
  });

  test("parses percentage lightness and slash alpha", () => {
    const pct = parseCssColorToOklab("oklch(70.7% 0.165 254.624)") ?? BLACK;
    const raw = parseCssColorToOklab("oklch(0.707 0.165 254.624)") ?? BLACK;
    assertClose(pct.l, raw.l, 1e-6);

    const slashAlpha = parseCssColorToOklab("oklch(0.5 0.1 200 / 50%)");
    assertClose(slashAlpha?.alpha ?? Number.NaN, 0.5, 1e-6);
    const legacyAlpha = parseCssColorToOklab("rgba(255, 0, 0, 0.25)");
    assertClose(legacyAlpha?.alpha ?? Number.NaN, 0.25, 1e-6);
  });

  test("parses color(srgb …), oklab(), and transparent", () => {
    const srgb = parseCssColorToOklab("color(srgb 1 0 0)") ?? BLACK;
    const hex = parseCssColorToOklab("#ff0000") ?? BLACK;
    assertClose(srgb.l, hex.l, 1e-6);

    assert.deepStrictEqual(parseCssColorToOklab("oklab(0.5 0.05 -0.05)"), {
      a: 0.05,
      alpha: 1,
      b: -0.05,
      l: 0.5,
    });

    assert.deepStrictEqual(parseCssColorToOklab("transparent"), {
      a: 0,
      alpha: 0,
      b: 0,
      l: 0,
    });
  });

  test("rejects what it does not understand", () => {
    assert.strictEqual(parseCssColorToOklab(""), null);
    assert.strictEqual(parseCssColorToOklab("hsl(200 50% 50%)"), null);
    assert.strictEqual(parseCssColorToOklab("#12"), null);
  });
});
