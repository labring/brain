import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveCanvasViewportFocus } from "./canvas.viewport-focus";

test("focuses the node in the canvas area left visible by a right inset", () => {
  const result = resolveCanvasViewportFocus({
    flowHeight: 800,
    flowWidth: 1200,
    maxZoom: 1.05,
    minZoom: 0.85,
    node: { height: 100, width: 200, x: 400, y: 300 },
    rightInset: 640,
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  assert.deepEqual(result, {
    kind: "setViewport",
    viewport: {
      x: -220,
      y: 50,
      zoom: 1,
    },
  });
});

test("zooms into the comfortable range when the canvas is too far away", () => {
  const result = resolveCanvasViewportFocus({
    flowHeight: 800,
    flowWidth: 1200,
    maxZoom: 1.05,
    minZoom: 0.85,
    node: { height: 100, width: 200, x: 400, y: 300 },
    rightInset: 640,
    viewport: { x: 0, y: 0, zoom: 0.3 },
  });

  assert.deepEqual(result, {
    kind: "setViewport",
    viewport: {
      x: -145,
      y: 102.5,
      zoom: 0.85,
    },
  });
});

test("zooms out to the comfortable range when the canvas is too close", () => {
  const result = resolveCanvasViewportFocus({
    flowHeight: 800,
    flowWidth: 1200,
    maxZoom: 1.05,
    minZoom: 0.85,
    node: { height: 100, width: 200, x: 400, y: 300 },
    rightInset: 640,
    viewport: { x: 0, y: 0, zoom: 1.2 },
  });

  assert.deepEqual(result, {
    kind: "setViewport",
    viewport: {
      x: -245,
      y: 32.5,
      zoom: 1.05,
    },
  });
});

test("does not focus when the side pane leaves no visible canvas width", () => {
  const result = resolveCanvasViewportFocus({
    flowHeight: 800,
    flowWidth: 640,
    maxZoom: 1.05,
    minZoom: 0.85,
    node: { height: 100, width: 200, x: 400, y: 300 },
    rightInset: 640,
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  assert.deepEqual(result, { kind: "none" });
});
