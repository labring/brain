import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasNodePlaceholder } from "./canvas-node.placeholder";
import { CanvasNodeRoot } from "./canvas-node.root";

const CONNECTION_ANCHOR_RE = /data-slot="canvas-node-connection-anchor"/;
const CONNECTION_SIDE_RE = (side: string) =>
  new RegExp(`data-side="${side}"`, "g");

test("CanvasNodePlaceholder exposes the same connection anchors as canvas cards", () => {
  const html = renderToStaticMarkup(
    <CanvasNodeRoot>
      <CanvasNodePlaceholder aria-label="Deployment placeholder" />
    </CanvasNodeRoot>
  );

  assert.match(html, CONNECTION_ANCHOR_RE);
  for (const side of ["top", "right", "bottom", "left"]) {
    assert.equal(html.match(CONNECTION_SIDE_RE(side))?.length, 2);
  }
});
