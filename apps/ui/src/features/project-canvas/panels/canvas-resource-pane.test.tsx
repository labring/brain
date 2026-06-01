import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasResourcePane } from "./canvas-resource-pane";
import { renderProjectCanvasResourcePaneContent } from "./project-canvas-resource-pane";

const noop = () => {
  /* test noop */
};

const ASIDE_RE = /<aside/;
const BODY_RE = /Resource details/;
const CLOSE_LABEL_RE = /aria-label="Close resource pane"/;
const PANE_LABEL_RE = /aria-label="Canvas resource pane"/;
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
});

test("project canvas resource pane stays absent without resource content", () => {
  const html = renderToStaticMarkup(
    renderProjectCanvasResourcePaneContent({
      content: null,
      onClose: noop,
    })
  );

  assert.equal(html, "");
});
