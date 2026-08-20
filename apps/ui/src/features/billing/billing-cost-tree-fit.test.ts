import { describe, expect, test } from "bun:test";

import {
  computeCostTreeFit,
  unionContentBounds,
} from "./billing-cost-tree-fit";

const PADDING = { bottom: 16, left: 28, right: 16, top: 28 };

describe("unionContentBounds", () => {
  test("returns null for an empty list", () => {
    expect(unionContentBounds([])).toBeNull();
  });

  test("unions multiple rects", () => {
    expect(
      unionContentBounds([
        { height: 10, width: 20, x: 0, y: 0 },
        { height: 10, width: 20, x: 100, y: 50 },
      ])
    ).toEqual({ maxX: 120, maxY: 60, minX: 0, minY: 0 });
  });
});

describe("computeCostTreeFit", () => {
  test("top-left aligns content into the usable rect at scale 1 when it fits", () => {
    const result = computeCostTreeFit({
      bounds: { maxX: 200, maxY: 100, minX: 0, minY: 0 },
      maxScale: 1,
      minScale: 0.6,
      padding: PADDING,
      panelRightInset: 360,
      viewportHeight: 600,
      viewportWidth: 1000,
    });
    // Usable: left 28, top 28, width 1000-360-16-28=596, height 600-16-28=556
    expect(result.scale).toBe(1);
    expect(result.positionX).toBe(28);
    expect(result.positionY).toBe(28);
  });

  test("scales down so content fits the panel-inset usable width", () => {
    // Content 800 wide into usable ~596 → scale ~0.745
    const result = computeCostTreeFit({
      bounds: { maxX: 800, maxY: 100, minX: 0, minY: 0 },
      maxScale: 1,
      minScale: 0.6,
      padding: PADDING,
      panelRightInset: 360,
      viewportHeight: 600,
      viewportWidth: 1000,
    });
    expect(result.scale).toBeCloseTo(596 / 800, 5);
    expect(result.positionX).toBeCloseTo(28, 5);
    expect(result.positionY).toBeCloseTo(28, 5);
  });

  test("clamps to minScale and keeps top-left priority when content is huge", () => {
    const result = computeCostTreeFit({
      bounds: { maxX: 4000, maxY: 3000, minX: 0, minY: 0 },
      maxScale: 1,
      minScale: 0.6,
      padding: PADDING,
      panelRightInset: 360,
      viewportHeight: 400,
      viewportWidth: 800,
    });
    expect(result.scale).toBe(0.6);
    expect(result.positionX).toBe(28);
    expect(result.positionY).toBe(28);
  });

  test("does not scale above maxScale", () => {
    const result = computeCostTreeFit({
      bounds: { maxX: 40, maxY: 20, minX: 0, minY: 0 },
      maxScale: 1,
      minScale: 0.6,
      padding: PADDING,
      panelRightInset: 100,
      viewportHeight: 800,
      viewportWidth: 1200,
    });
    expect(result.scale).toBe(1);
  });

  test("offsets non-zero content min corner into usable top-left", () => {
    const result = computeCostTreeFit({
      bounds: { maxX: 120, maxY: 80, minX: 20, minY: 10 },
      maxScale: 1,
      minScale: 0.6,
      padding: PADDING,
      panelRightInset: 200,
      viewportHeight: 500,
      viewportWidth: 900,
    });
    expect(result.scale).toBe(1);
    expect(result.positionX).toBe(28 - 20);
    expect(result.positionY).toBe(28 - 10);
  });
});
