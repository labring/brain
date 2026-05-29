import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { WORKLOAD_PANE } from "@/store/canvas-store";
import { CanvasResourcePane } from "./canvas-resource-pane";
import { renderProjectCanvasResourcePaneContent } from "./project-canvas-resource-pane";

const noop = () => {
  /* test noop */
};

const ASIDE_RE = /<aside/;
const BODY_RE = /Resource details/;
const CLOSE_LABEL_RE = /aria-label="Close resource pane"/;
const PANE_LABEL_RE = /aria-label="Canvas resource pane"/;
const RESOURCE_PANE_BACKGROUND_RE = /bg-resource-pane/;
const RESOURCE_PANE_SURFACE_RE = /resource-pane-surface/;
const SUBTITLE_RE = /Runtime details/;
const TITLE_RE = /Container/;

test("canvas resource pane preserves resource-specific chrome while using the shared side pane", () => {
  const html = renderToStaticMarkup(
    <CanvasResourcePane
      onClose={noop}
      subtitle="Runtime details"
      title="Container"
    >
      <p>Resource details</p>
    </CanvasResourcePane>
  );

  assert.match(html, ASIDE_RE);
  assert.match(html, PANE_LABEL_RE);
  assert.match(html, CLOSE_LABEL_RE);
  assert.match(html, TITLE_RE);
  assert.match(html, SUBTITLE_RE);
  assert.match(html, BODY_RE);
  assert.match(html, RESOURCE_PANE_SURFACE_RE);
  assert.match(html, RESOURCE_PANE_BACKGROUND_RE);
});

test("project canvas resource pane does not render workload logs as side pane content", () => {
  const html = renderToStaticMarkup(
    renderProjectCanvasResourcePaneContent({
      databasePane: null,
      entryPane: null,
      onClose: noop,
      selectedDatabaseData: null,
      selectedEntryRef: null,
      selectedNode: {
        data: {},
        id: "ap:web",
        position: { x: 0, y: 0 },
        type: "container",
      },
      workloadPane: WORKLOAD_PANE.logs,
    })
  );

  assert.equal(html, "");
});
