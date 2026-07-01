import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CANVAS_CONTROLS_SOURCE = readFileSync(
  new URL("./canvas.controls.tsx", import.meta.url),
  "utf8"
);
const NAVIGATION_CHROME_CONSTANT_RE =
  /CANVAS_NAVIGATION_CHROME_CLASS =\s+"rounded-lg bg-\[#09090b\]\/10 backdrop-blur-lg"/;
const NAVIGATION_CHROME_USAGE_RE = /CANVAS_NAVIGATION_CHROME_CLASS/;
const MINIMAP_FIXED_FRAME_RE = /h-\[130px\] w-\[223px\]/;

function sourceBeforeCanvasMiniMapSlot() {
  const slotIndex = CANVAS_CONTROLS_SOURCE.indexOf(
    'data-slot="canvas-minimap"'
  );
  assert.notEqual(slotIndex, -1, "canvas minimap slot should be present");
  return CANVAS_CONTROLS_SOURCE.slice(Math.max(0, slotIndex - 700), slotIndex);
}

test("canvas minimap uses the same glass chrome material as canvas controls", () => {
  const minimapSource = sourceBeforeCanvasMiniMapSlot();

  assert.match(CANVAS_CONTROLS_SOURCE, NAVIGATION_CHROME_CONSTANT_RE);
  assert.match(minimapSource, MINIMAP_FIXED_FRAME_RE);
  assert.match(minimapSource, NAVIGATION_CHROME_USAGE_RE);
});
