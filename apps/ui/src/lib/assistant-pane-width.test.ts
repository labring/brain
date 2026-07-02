import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSISTANT_PANE_DEFAULT_WIDTH,
  ASSISTANT_PANE_MIN_WIDTH,
  assistantPaneMaxWidth,
  clampAssistantPaneWidth,
  parseAssistantPaneWidth,
} from "./assistant-pane-width";

test("clampAssistantPaneWidth keeps width between min and half the workspace", () => {
  assert.equal(clampAssistantPaneWidth(416, 1400), 416);
  assert.equal(clampAssistantPaneWidth(200, 1400), ASSISTANT_PANE_MIN_WIDTH);
  assert.equal(clampAssistantPaneWidth(900, 1400), 700);
  assert.equal(clampAssistantPaneWidth(650.4, 1400), 650);
});

test("clampAssistantPaneWidth without a known workspace only enforces the minimum", () => {
  assert.equal(clampAssistantPaneWidth(800, 0), 800);
  assert.equal(clampAssistantPaneWidth(100, 0), ASSISTANT_PANE_MIN_WIDTH);
  assert.equal(
    clampAssistantPaneWidth(800, Number.NaN),
    800,
    "NaN workspace keeps remembered intent"
  );
});

test("clampAssistantPaneWidth falls back to the default for invalid widths", () => {
  assert.equal(
    clampAssistantPaneWidth(Number.NaN, 1400),
    ASSISTANT_PANE_DEFAULT_WIDTH
  );
});

test("assistantPaneMaxWidth never drops below the minimum", () => {
  assert.equal(assistantPaneMaxWidth(500), ASSISTANT_PANE_MIN_WIDTH);
  assert.equal(assistantPaneMaxWidth(2000), 1000);
  assert.equal(assistantPaneMaxWidth(0), ASSISTANT_PANE_MIN_WIDTH);
  assert.equal(assistantPaneMaxWidth(Number.NaN), ASSISTANT_PANE_MIN_WIDTH);
});

test("parseAssistantPaneWidth rejects garbage and below-minimum values", () => {
  assert.equal(parseAssistantPaneWidth(null), null);
  assert.equal(parseAssistantPaneWidth("abc"), null);
  assert.equal(parseAssistantPaneWidth("100"), null);
  assert.equal(parseAssistantPaneWidth("480"), 480);
  assert.equal(parseAssistantPaneWidth("480.7"), 480);
});
