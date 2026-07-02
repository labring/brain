import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { DropdownMenu } from "../dropdown-menu";
import {
  CanvasNodeActionButton,
  CanvasNodeActionMenuItem,
} from "./canvas-node.actions";

const DISABLED_REASON = "Resource credentials are not available.";
const ARIA_DISABLED_RE = /aria-disabled="true"/;
const BUTTON_REASON_DESCRIPTION_RE =
  /aria-description="Resource credentials are not available\."/;
const DISABLED_REASON_TITLE_RE =
  /title="Resource credentials are not available\."/;
const RESTART_LABEL_RE = /Restart/;
const RESTART_ACTION_KEY_RE = /data-action-key="restart"/;

test("CanvasNodeActionButton exposes disabled reasons at the trigger", () => {
  const html = renderToStaticMarkup(
    <CanvasNodeActionButton
      action={{
        disabled: true,
        disabledReason: DISABLED_REASON,
      }}
      aria-label="Open terminal"
    >
      T
    </CanvasNodeActionButton>
  );

  assert.match(html, ARIA_DISABLED_RE);
  assert.match(html, BUTTON_REASON_DESCRIPTION_RE);
  assert.doesNotMatch(html, DISABLED_REASON_TITLE_RE);
});

test("CanvasNodeActionMenuItem exposes disabled reasons", () => {
  const html = renderToStaticMarkup(
    <DropdownMenu open>
      <CanvasNodeActionMenuItem
        action={{
          disabled: true,
          disabledReason: DISABLED_REASON,
        }}
        actionKey="restart"
      >
        Restart
      </CanvasNodeActionMenuItem>
    </DropdownMenu>
  );

  assert.match(html, RESTART_LABEL_RE);
  assert.match(html, RESTART_ACTION_KEY_RE);
  assert.doesNotMatch(html, DISABLED_REASON_TITLE_RE);
});
