import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  alternateEasedProgress,
  cssEaseInOut,
  glowPose,
  type HorizonMotionValues,
  huesPose,
  surgePose,
} from "./horizon-anim";

const MOTION: HorizonMotionValues = {
  huesDuration: 5,
  surgeDuration: 5,
  surgeOpacityMax: 0.95,
  surgeOpacityMin: 0.45,
  surgeScaleMax: 1.22,
  surgeScaleMin: 0.85,
  swellDuration: 6,
  swellOpacityMin: 0.75,
  swellScaleMax: 1.12,
  swellScaleMin: 0.9,
};

const assertClose = (actual: number, expected: number, tolerance = 1e-5) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} ≈ ${expected} (±${tolerance})`
  );
};

describe("cssEaseInOut", () => {
  test("pins the endpoints", () => {
    assert.strictEqual(cssEaseInOut(0), 0);
    assert.strictEqual(cssEaseInOut(1), 1);
    assert.strictEqual(cssEaseInOut(-0.5), 0);
    assert.strictEqual(cssEaseInOut(1.5), 1);
  });

  test("is symmetric around the midpoint", () => {
    assertClose(cssEaseInOut(0.5), 0.5);
    assertClose(cssEaseInOut(0.25) + cssEaseInOut(0.75), 1);
  });

  test("eases in (slow start) and stays monotonic", () => {
    assert.ok(cssEaseInOut(0.2) < 0.2);
    let previous = 0;
    for (let i = 1; i <= 20; i++) {
      const value = cssEaseInOut(i / 20);
      assert.ok(value >= previous);
      previous = value;
    }
  });
});

describe("alternateEasedProgress", () => {
  test("runs forward on the first iteration", () => {
    assert.strictEqual(alternateEasedProgress(0, 5), 0);
    assertClose(alternateEasedProgress(2.5, 5), 0.5);
    assert.strictEqual(alternateEasedProgress(5, 5), 1);
  });

  test("reverses on odd iterations", () => {
    assertClose(alternateEasedProgress(7.5, 5), 0.5);
    assert.strictEqual(alternateEasedProgress(10, 5), 0);
    assert.ok(alternateEasedProgress(6, 5) > alternateEasedProgress(7, 5));
  });

  test("negative delay of one duration starts at the `to` state", () => {
    assert.strictEqual(alternateEasedProgress(0, 5, -5), 1);
    assertClose(alternateEasedProgress(2.5, 5, -5), 0.5);
    assert.strictEqual(alternateEasedProgress(5, 5, -5), 0);
  });
});

describe("layer poses", () => {
  test("glow starts at the `from` keyframe and peaks after one duration", () => {
    assert.deepStrictEqual(glowPose(0, MOTION), {
      opacity: MOTION.swellOpacityMin,
      scale: MOTION.swellScaleMin,
    });
    assert.deepStrictEqual(glowPose(MOTION.swellDuration, MOTION), {
      opacity: 1,
      scale: MOTION.swellScaleMax,
    });
  });

  test("hues starts reversed (CSS negative animation-delay)", () => {
    assert.deepStrictEqual(huesPose(0, MOTION), {
      opacity: 1,
      scale: MOTION.swellScaleMax,
    });
    assert.deepStrictEqual(huesPose(MOTION.huesDuration, MOTION), {
      opacity: MOTION.swellOpacityMin,
      scale: MOTION.swellScaleMin,
    });
  });

  test("surge sweeps its own opacity and scale range", () => {
    assert.deepStrictEqual(surgePose(0, MOTION), {
      opacity: MOTION.surgeOpacityMin,
      scale: MOTION.surgeScaleMin,
    });
    assert.deepStrictEqual(surgePose(MOTION.surgeDuration, MOTION), {
      opacity: MOTION.surgeOpacityMax,
      scale: MOTION.surgeScaleMax,
    });
  });
});
