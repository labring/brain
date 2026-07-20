import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EntryNodeContent } from "./entry-node.content";
import { EntryNodeRoot } from "./entry-node.root";
import type { EntryNodeTarget } from "./entry-node.types";

const ENTRY_STATES = { name: "hbxiix.192.168.10.189.nip.io" } as const;
const PLATFORM_TARGET: EntryNodeTarget = {
  id: "platform",
  label: "Platform Address",
  status: { label: "Accessible", tone: "accessible" },
  value: "https://hbxiix.192.168.10.189.nip.io/",
};
const PENDING_TARGET: EntryNodeTarget = {
  id: "pending",
  label: "Platform Address",
  status: { label: "Progressing", tone: "progressing" },
  value: "Pending",
};

const VALUE_LINK_RE = /<a [^>]*data-slot="canvas-node-row-value"/;
const PLATFORM_HREF_RE =
  /href="https:\/\/hbxiix\.192\.168\.10\.189\.nip\.io\/"/;
const NEW_TAB_RE = /target="_blank"/;
const NO_OPENER_RE = /rel="noopener noreferrer"/;
const VALUE_TEXT_RE = /<span [^>]*data-slot="canvas-node-row-value"/;
const COPY_BUTTON_SLOT_RE = /data-slot="canvas-node-row-copy-button"/;
const COPY_PLATFORM_ADDRESS_RE = /aria-label="Copy Platform Address"/;
const COPIED_PLATFORM_ADDRESS_RE = /aria-label="Copied Platform Address"/;

function renderTargets(
  targets: EntryNodeTarget[],
  copiedTargetKey?: string
): string {
  return renderToStaticMarkup(
    <EntryNodeRoot
      copiedTargetKey={copiedTargetKey}
      states={ENTRY_STATES}
      targets={targets}
    >
      <EntryNodeContent />
    </EntryNodeRoot>
  );
}

test("EntryNode target row renders an http(s) value as a new-tab link", () => {
  const html = renderTargets([PLATFORM_TARGET]);

  assert.match(html, VALUE_LINK_RE);
  assert.match(html, PLATFORM_HREF_RE);
  assert.match(html, NEW_TAB_RE);
  assert.match(html, NO_OPENER_RE);
});

test("EntryNode target row renders an explicit copy button", () => {
  const html = renderTargets([PLATFORM_TARGET]);

  assert.match(html, COPY_BUTTON_SLOT_RE);
  assert.match(html, COPY_PLATFORM_ADDRESS_RE);
});

test("EntryNode target row keeps a pending value as plain text", () => {
  const html = renderTargets([PENDING_TARGET]);

  assert.doesNotMatch(html, VALUE_LINK_RE);
  assert.match(html, VALUE_TEXT_RE);
});

test("EntryNode target row keeps a non-http value as plain text", () => {
  const html = renderTargets([
    { ...PLATFORM_TARGET, value: "ftp://hbxiix.192.168.10.189.nip.io/" },
  ]);

  assert.doesNotMatch(html, VALUE_LINK_RE);
  assert.match(html, VALUE_TEXT_RE);
});

test("EntryNode target row pins copied feedback on the copy button", () => {
  const html = renderTargets([PLATFORM_TARGET], "platform");

  assert.match(html, COPIED_PLATFORM_ADDRESS_RE);
});
