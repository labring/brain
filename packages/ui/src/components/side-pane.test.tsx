import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SidePane, SidePanePresence } from "./side-pane";

const noop = () => {
  /* test noop */
};

const ASIDE_RE = /<aside/;
const BODY_RE = /Pane body/;
const BUSY_RE = /aria-busy="true"/;
const CLOSE_LABEL_RE = /Close details/;
const CLOSED_RE = /aria-hidden="true"/;
const DESCRIPTION_RE = /Secondary copy/;
const MOTION_REDUCE_TRANSFORM_RE = /motion-reduce:transform-none/;
const MOTION_REDUCE_TRANSITION_RE = /motion-reduce:transition-none/;
const OPEN_ASIDE_RE = /<aside aria-hidden="false"/;
const OPEN_DURATION_RE =
  /duration-\[var\(--project-surface-motion-enter-duration\)\]/;
const OPEN_MAX_WIDTH_RE = /max-w-screen-sm/;
const OPEN_OPACITY_RE = /opacity-100/;
const OPEN_TRANSLATE_RE = /translate-x-0/;
const OPEN_WIDTH_RE = /w-full/;
const PANE_LABEL_RE = /aria-label="Details pane"/;
const POINTER_EVENTS_NONE_RE = /pointer-events-none/;
const PROJECT_CHROME_SURFACE_RE = /project-chrome-surface/;
const SCROLL_BEFORE_CONTENT_GAP_RE = /flex min-h-0 flex-1 flex-col gap-2.5/;
const SCROLL_BODY_RE = /scrollbar-chat-thin min-h-0 flex-1 overflow-y-auto/;
const SCROLL_CONTENT_RE =
  /flex min-h-full min-w-0 flex-col gap-5 px-5 pt-2.5 pb-5/;
const TITLE_RE = /Details/;
const TITLE_ROW_GAP_RE = /flex min-w-0 items-center gap-2"/;
const TRANSLATE_CLOSED_RE = /translate-x-full/;

function indexOfOrThrow(source: string, needle: string) {
  const index = source.indexOf(needle);
  assert.notEqual(index, -1, `${needle} should be present`);
  return index;
}

test("side pane renders shared chrome, accessibility labels, and motion-safe classes", () => {
  const html = renderToStaticMarkup(
    <SidePane
      busy
      closeAriaLabel="Close details"
      icon={<span data-slot="test-icon" />}
      label="Details pane"
      onClose={noop}
      subtitle="Secondary copy"
      title="Details"
    >
      <p>Pane body</p>
    </SidePane>
  );

  assert.match(html, ASIDE_RE);
  assert.match(html, PANE_LABEL_RE);
  assert.match(html, BUSY_RE);
  assert.match(html, CLOSE_LABEL_RE);
  assert.match(html, TITLE_RE);
  assert.match(html, DESCRIPTION_RE);
  assert.match(html, BODY_RE);
  assert.match(html, PROJECT_CHROME_SURFACE_RE);
  assert.match(html, MOTION_REDUCE_TRANSITION_RE);
  assert.match(html, SCROLL_BEFORE_CONTENT_GAP_RE);
  assert.match(html, TITLE_ROW_GAP_RE);
});

test("side pane keeps shared header outside the edge-aligned scroll body", () => {
  const html = renderToStaticMarkup(
    <SidePane label="Details pane" onClose={noop} title="Details">
      <p>Pane body</p>
    </SidePane>
  );

  const headerIndex = indexOfOrThrow(html, "<header");
  const scrollBodyIndex = indexOfOrThrow(html, SCROLL_BODY_RE.source);
  const scrollContentIndex = indexOfOrThrow(html, SCROLL_CONTENT_RE.source);
  const bodyIndex = indexOfOrThrow(html, "Pane body");

  assert.ok(headerIndex < scrollBodyIndex);
  assert.ok(scrollBodyIndex < scrollContentIndex);
  assert.ok(scrollContentIndex < bodyIndex);
});

test("side pane closed state is non-interactive and keeps reduced-motion structure", () => {
  const html = renderToStaticMarkup(
    <SidePane
      closeAriaLabel="Close"
      label="Details pane"
      onClose={noop}
      open={false}
      title="Details"
    >
      <p>Pane body</p>
    </SidePane>
  );

  assert.match(html, CLOSED_RE);
  assert.match(html, POINTER_EVENTS_NONE_RE);
  assert.match(html, TRANSLATE_CLOSED_RE);
  assert.match(html, MOTION_REDUCE_TRANSFORM_RE);
});

test("side pane presence renders initial pane content open", () => {
  const html = renderToStaticMarkup(
    <SidePanePresence>
      <SidePane label="Details pane" onClose={noop} title="Details">
        <p>Pane body</p>
      </SidePane>
    </SidePanePresence>
  );

  assert.match(html, PANE_LABEL_RE);
  assert.match(html, OPEN_ASIDE_RE);
  assert.match(html, OPEN_WIDTH_RE);
  assert.match(html, OPEN_MAX_WIDTH_RE);
  assert.match(html, OPEN_TRANSLATE_RE);
  assert.match(html, OPEN_OPACITY_RE);
  assert.match(html, OPEN_DURATION_RE);
  assert.doesNotMatch(html, TRANSLATE_CLOSED_RE);
});
