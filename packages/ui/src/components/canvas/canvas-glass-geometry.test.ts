import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildGlassSheetGeometry,
  CANVAS_GLASS_SHEET_PADDING,
  type GlassNodeRect,
  glassRectsOverlap,
  glassRectsSignature,
  splitGlassOverlaps,
} from "./canvas-glass-geometry";

function rect(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 60
): GlassNodeRect {
  return { height, id, width, x, y };
}

test("glassRectsOverlap detects intersection, ignores touching edges", () => {
  assert.equal(glassRectsOverlap(rect("a", 0, 0), rect("b", 50, 30)), true);
  // b starts exactly where a ends on x — flush, not overlapping.
  assert.equal(glassRectsOverlap(rect("a", 0, 0), rect("b", 100, 0)), false);
  assert.equal(glassRectsOverlap(rect("a", 0, 0), rect("b", 300, 300)), false);
});

test("splitGlassOverlaps flags every node in an overlapping pair", () => {
  const a = rect("a", 0, 0);
  const b = rect("b", 40, 20); // overlaps a
  const c = rect("c", 400, 400); // isolated
  const { isolated, overlapping } = splitGlassOverlaps([a, b, c]);
  assert.deepEqual([...overlapping].sort(), ["a", "b"]);
  assert.deepEqual(
    isolated.map((r) => r.id),
    ["c"]
  );
});

test("splitGlassOverlaps returns all isolated when nothing overlaps", () => {
  const rects = [rect("a", 0, 0), rect("b", 200, 0), rect("c", 400, 0)];
  const { isolated, overlapping } = splitGlassOverlaps(rects);
  assert.equal(overlapping.size, 0);
  assert.equal(isolated.length, 3);
});

test("buildGlassSheetGeometry returns null when nothing is isolated", () => {
  assert.equal(buildGlassSheetGeometry([]), null);
});

test("buildGlassSheetGeometry pads bounds and offsets the mask per node", () => {
  const geometry = buildGlassSheetGeometry([rect("a", 100, 200, 100, 60)]);
  assert.ok(geometry);
  assert.equal(geometry.left, 100 - CANVAS_GLASS_SHEET_PADDING);
  assert.equal(geometry.top, 200 - CANVAS_GLASS_SHEET_PADDING);
  assert.equal(geometry.width, 100 + CANVAS_GLASS_SHEET_PADDING * 2);
  assert.equal(geometry.height, 60 + CANVAS_GLASS_SHEET_PADDING * 2);
  // The node's hole sits exactly one padding in from the sheet's origin.
  assert.equal(
    geometry.maskPosition,
    `${CANVAS_GLASS_SHEET_PADDING}px ${CANVAS_GLASS_SHEET_PADDING}px`
  );
});

test("glassRectsSignature is stable under reorder-free identity, changes on move", () => {
  const before = glassRectsSignature([rect("a", 0, 0), rect("b", 200, 0)]);
  const same = glassRectsSignature([rect("a", 0, 0), rect("b", 200, 0)]);
  const moved = glassRectsSignature([rect("a", 0, 0), rect("b", 201, 0)]);
  assert.equal(before, same);
  assert.notEqual(before, moved);
});
