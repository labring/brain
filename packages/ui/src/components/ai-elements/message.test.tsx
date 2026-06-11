import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageAction } from "./message";

const COPY_MESSAGE_ARIA_LABEL_RE = /aria-label="Copy message"/;

test("message action with tooltip renders a single button trigger", () => {
  const html = renderToStaticMarkup(
    <MessageAction aria-label="Copy message" tooltip="Copy message">
      Copy
    </MessageAction>
  );

  const buttonCount = html.match(/<button/g)?.length ?? 0;

  assert.equal(buttonCount, 1);
  assert.match(html, COPY_MESSAGE_ARIA_LABEL_RE);
});
