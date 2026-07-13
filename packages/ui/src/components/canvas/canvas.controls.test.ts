import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CANVAS_CONTROLS_SOURCE = readFileSync(
  new URL("./canvas.controls.tsx", import.meta.url),
  "utf8"
);
const CANVAS_MINIMAP_SOURCE = readFileSync(
  new URL("./canvas.minimap.tsx", import.meta.url),
  "utf8"
);
const NAVIGATION_CHROME_CONSTANT_RE =
  /CANVAS_NAVIGATION_CHROME_CLASS =\s+"rounded-lg bg-\[#09090b\]\/10 backdrop-blur-lg"/;
const NAVIGATION_CHROME_USAGE_RE = /CANVAS_NAVIGATION_CHROME_CLASS/;
const MINIMAP_LEGACY_CHROME_RE =
  /absolute top-\[60px\] left-3 z-10 h-\[130px\] w-\[223px\] overflow-hidden transition-\[right,opacity\]/;
const MINIMAP_LEGACY_BACKGROUND_RE =
  /"--xy-minimap-background-color-props":\s*"color-mix\(in oklab, var\(--input\) 30%, transparent\)"/;
const MINIMAP_LEGACY_MASK_RE =
  /"--xy-minimap-mask-background-color-props":\s*"color-mix\(in oklab, var\(--input\) 30%, transparent\)"/;
const MINIMAP_LEGACY_CLASS_RE =
  /className="react-flow__minimap overflow-hidden bg-input\/30 shadow-none"/;

function canvasMiniMapSource() {
  const startIndex = CANVAS_CONTROLS_SOURCE.indexOf(
    "export function CanvasMiniMap"
  );
  assert.notEqual(startIndex, -1, "canvas minimap source should be present");
  return CANVAS_CONTROLS_SOURCE.slice(startIndex);
}

function sourceBeforeCanvasMiniMapSlot() {
  const minimapSource = canvasMiniMapSource();
  const slotIndex = minimapSource.indexOf('data-slot="canvas-minimap"');
  assert.notEqual(slotIndex, -1, "canvas minimap slot should be present");
  return minimapSource.slice(0, slotIndex);
}

test("canvas minimap keeps the legacy visual style with overlap blur", () => {
  const minimapChromeSource = sourceBeforeCanvasMiniMapSlot();

  assert.match(CANVAS_CONTROLS_SOURCE, NAVIGATION_CHROME_CONSTANT_RE);
  assert.match(minimapChromeSource, MINIMAP_LEGACY_CHROME_RE);
  assert.match(minimapChromeSource, NAVIGATION_CHROME_USAGE_RE);
  assert.match(CANVAS_MINIMAP_SOURCE, MINIMAP_LEGACY_BACKGROUND_RE);
  assert.match(CANVAS_MINIMAP_SOURCE, MINIMAP_LEGACY_MASK_RE);
  assert.match(CANVAS_MINIMAP_SOURCE, MINIMAP_LEGACY_CLASS_RE);
});
