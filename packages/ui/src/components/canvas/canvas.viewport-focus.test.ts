import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nodesBoundsForViewportFocus,
  resolveCanvasViewportFocus,
} from "./canvas.viewport-focus";

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

test("focuses the node in the canvas area above a bottom inset", () => {
  const result = resolveCanvasViewportFocus({
    bottomInset: 200,
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
      y: -50,
      zoom: 1,
    },
  });
});

test("zooms out when a footprint is larger than the visible canvas area", () => {
  const result = resolveCanvasViewportFocus({
    bottomInset: 200,
    flowHeight: 800,
    flowWidth: 1200,
    maxZoom: 1.05,
    minZoom: 0.3,
    node: { height: 400, width: 1000, x: 0, y: 0 },
    rightInset: 640,
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  assert.deepEqual(result, {
    kind: "setViewport",
    viewport: {
      x: 0,
      y: 188,
      zoom: 0.56,
    },
  });
});

test("does not focus when covered surfaces leave no visible canvas height", () => {
  const result = resolveCanvasViewportFocus({
    bottomInset: 800,
    flowHeight: 800,
    flowWidth: 1200,
    maxZoom: 1.05,
    minZoom: 0.85,
    node: { height: 100, width: 200, x: 400, y: 300 },
    rightInset: 640,
    viewport: { x: 0, y: 0, zoom: 1 },
  });

  assert.deepEqual(result, { kind: "none" });
});

test("combines multiple nodes into one viewport focus footprint", () => {
  const result = nodesBoundsForViewportFocus([
    {
      data: {},
      id: "a",
      position: { x: 400, y: 300 },
      type: "default",
      width: 200,
      height: 100,
    },
    {
      data: {},
      id: "b",
      measured: { width: 160, height: 80 },
      position: { x: 700, y: 120 },
      type: "default",
    },
  ]);

  assert.deepEqual(result, {
    height: 280,
    width: 460,
    x: 400,
    y: 120,
  });
});
