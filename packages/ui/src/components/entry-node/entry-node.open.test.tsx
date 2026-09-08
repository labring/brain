import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EntryNodeContent } from "./entry-node.content";
import { EntryNodeRoot } from "./entry-node.root";
import type { EntryNodeGroup, EntryNodeOpenTarget } from "./entry-node.types";

const ENTRY_STATES = { name: "minio" } as const;
const GROUPS: EntryNodeGroup[] = [
  {
    addresses: [
      {
        host: "s3.example.com",
        id: "s3",
        status: { label: "Accessible", tone: "accessible" },
        value: "https://s3.example.com/",
      },
    ],
    name: "S3 API",
    port: 9000,
  },
  {
    addresses: [
      {
        host: "console.example.com",
        id: "console",
        status: { label: "Accessible", tone: "accessible" },
        value: "https://console.example.com/",
      },
    ],
    name: "Console",
    port: 9001,
  },
];

const OPEN_ANCHOR_RE = /<a [^>]*data-slot="entry-node-open"/;
const OPEN_BUTTON_RE = /<button [^>]*data-slot="entry-node-open"/;
const OPEN_CONSOLE_LABEL_RE = /aria-label="Open Console"/;
const OPEN_LABEL_RE = /aria-label="Open"/;
const CONSOLE_HREF_RE = /href="https:\/\/console\.example\.com\/"/;
const NEW_TAB_RE = /target="_blank"/;
const NO_OPENER_RE = /rel="noopener noreferrer"/;
const DISABLED_RE = /aria-disabled="true"/;
const NOT_ACCESSIBLE_RE = /aria-description="Not accessible yet"/;
const NOT_CONFIGURED_RE = /aria-description="Not configured"/;
const STATUS_PILL_RE = /canvas-node-status-dot/;
const TWO_ADDRESSES_RE = />2 addresses</;

function renderOpen(
  open: EntryNodeOpenTarget | undefined,
  groups: EntryNodeGroup[] = GROUPS,
  defaultExpanded = true
): string {
  return renderToStaticMarkup(
    <EntryNodeRoot
      defaultExpanded={defaultExpanded}
      groups={groups}
      open={open}
      states={ENTRY_STATES}
    >
      <EntryNodeContent />
    </EntryNodeRoot>
  );
}

test("EntryNode header opens the Default Open Port's URL in a new tab", () => {
  const html = renderOpen({
    label: "Open Console",
    url: "https://console.example.com/",
  });

  assert.match(html, OPEN_ANCHOR_RE);
  assert.match(html, OPEN_CONSOLE_LABEL_RE);
  assert.match(html, CONSOLE_HREF_RE);
  assert.match(html, NEW_TAB_RE);
  assert.match(html, NO_OPENER_RE);
  assert.doesNotMatch(html, DISABLED_RE);
  assert.match(html, TWO_ADDRESSES_RE);
});

test("EntryNode header draws no aggregate health pill", () => {
  const html = renderOpen({
    label: "Open Console",
    url: "https://console.example.com/",
  });

  assert.doesNotMatch(html, STATUS_PILL_RE);
});

test("EntryNode header keeps the Open control in the collapsed node", () => {
  const html = renderOpen(
    { label: "Open Console", url: "https://console.example.com/" },
    GROUPS,
    false
  );

  assert.match(html, OPEN_ANCHOR_RE);
  assert.match(html, OPEN_CONSOLE_LABEL_RE);
});

test("EntryNode header disables Open with a reason while nothing is accessible", () => {
  const html = renderOpen({ label: "Open Console" });

  assert.match(html, OPEN_BUTTON_RE);
  assert.doesNotMatch(html, OPEN_ANCHOR_RE);
  assert.match(html, OPEN_CONSOLE_LABEL_RE);
  assert.match(html, DISABLED_RE);
  assert.match(html, NOT_ACCESSIBLE_RE);
});

test("EntryNode header disables Open as not configured without a target", () => {
  const html = renderOpen(undefined, []);

  assert.match(html, OPEN_BUTTON_RE);
  assert.match(html, OPEN_LABEL_RE);
  assert.match(html, DISABLED_RE);
  assert.match(html, NOT_CONFIGURED_RE);
});
