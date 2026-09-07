import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { EntryNodeContent } from "./entry-node.content";
import { EntryNodeRoot } from "./entry-node.root";
import type { EntryNodeAddress, EntryNodeGroup } from "./entry-node.types";

const ENTRY_STATES = { name: "hbxiix.192.168.10.189.nip.io" } as const;
const PLATFORM_ADDRESS: EntryNodeAddress = {
  host: "hbxiix.192.168.10.189.nip.io",
  hostSuffix: ".192.168.10.189.nip.io",
  id: "platform",
  status: { label: "Accessible", tone: "accessible" },
  value: "https://hbxiix.192.168.10.189.nip.io/",
};
const PENDING_ADDRESS: EntryNodeAddress = {
  host: "Pending",
  id: "pending",
  status: { label: "Progressing", tone: "progressing" },
};
const WS_ADDRESS: EntryNodeAddress = {
  host: "game.192.168.10.189.nip.io",
  id: "ws",
  status: { label: "Accessible", tone: "accessible" },
  value: "wss://game.192.168.10.189.nip.io/",
};

const VALUE_LINK_RE = /<a [^>]*data-slot="canvas-node-row-value"/;
const PLATFORM_HREF_RE =
  /href="https:\/\/hbxiix\.192\.168\.10\.189\.nip\.io\/"/;
const NEW_TAB_RE = /target="_blank"/;
const NO_OPENER_RE = /rel="noopener noreferrer"/;
const VALUE_TEXT_RE = /<span [^>]*data-slot="canvas-node-row-value"/;
const COPY_BUTTON_SLOT_RE = /data-slot="canvas-node-row-copy-button"/;
const COPY_PLATFORM_ADDRESS_RE =
  /aria-label="Copy https:\/\/hbxiix\.192\.168\.10\.189\.nip\.io\/"/;
const COPIED_PLATFORM_ADDRESS_RE =
  /aria-label="Copied https:\/\/hbxiix\.192\.168\.10\.189\.nip\.io\/"/;
const GROUP_HEADER_RE = /data-slot="entry-node-group-header"/;
const GROUP_HEADER_RE_GLOBAL = /data-slot="entry-node-group-header"/g;
const HOST_SUFFIX_RE =
  /<span [^>]*data-slot="entry-node-host-suffix"[^>]*>\.192\.168\.10\.189\.nip\.io<\/span>/;
const HOST_PREFIX_RE = />hbxiix</;
const PUBLIC_ACCESS_LABEL_RE = />Public access</;
const ONE_ADDRESS_RE = />1 address</;
const TWO_ADDRESSES_RE = />2 addresses</;
const NO_ADDRESSES_RE = />No addresses</;
const PLATFORM_ADDRESS_KIND_RE = /Platform Address/;
const CUSTOM_DOMAIN_KIND_RE = /Custom Domain/;
const NOT_CONFIGURED_RE = />Not configured</;

function renderGroups(
  groups: EntryNodeGroup[],
  copiedAddressKey?: string
): string {
  return renderToStaticMarkup(
    <EntryNodeRoot
      copiedAddressKey={copiedAddressKey}
      groups={groups}
      states={ENTRY_STATES}
    >
      <EntryNodeContent />
    </EntryNodeRoot>
  );
}

function headerTexts(html: string): string[] {
  return Array.from(
    html.matchAll(
      /data-slot="entry-node-group-header"[^>]*>([\s\S]*?)<\/div>/g
    ),
    (match) => (match[1] ?? "").replace(/<[^>]+>/g, "")
  );
}

test("EntryNode address row renders an http(s) value as a new-tab link", () => {
  const html = renderGroups([{ addresses: [PLATFORM_ADDRESS], port: 8080 }]);

  assert.match(html, VALUE_LINK_RE);
  assert.match(html, PLATFORM_HREF_RE);
  assert.match(html, NEW_TAB_RE);
  assert.match(html, NO_OPENER_RE);
});

test("EntryNode address row renders an explicit copy button for the full URL", () => {
  const html = renderGroups([{ addresses: [PLATFORM_ADDRESS], port: 8080 }]);

  assert.match(html, COPY_BUTTON_SLOT_RE);
  assert.match(html, COPY_PLATFORM_ADDRESS_RE);
});

test("EntryNode address row de-emphasises the platform suffix and shows no kind label", () => {
  const html = renderGroups([{ addresses: [PLATFORM_ADDRESS], port: 8080 }]);

  assert.match(html, HOST_PREFIX_RE);
  assert.match(html, HOST_SUFFIX_RE);
  assert.doesNotMatch(html, PLATFORM_ADDRESS_KIND_RE);
  assert.doesNotMatch(html, CUSTOM_DOMAIN_KIND_RE);
});

test("EntryNode address row keeps a pending address as plain, non-copyable text", () => {
  const html = renderGroups([{ addresses: [PENDING_ADDRESS], port: 8080 }]);

  assert.doesNotMatch(html, VALUE_LINK_RE);
  assert.match(html, VALUE_TEXT_RE);
  assert.doesNotMatch(html, COPY_BUTTON_SLOT_RE);
});

test("EntryNode address row keeps a WebSocket address copy-only", () => {
  const html = renderGroups([{ addresses: [WS_ADDRESS], port: 5200 }]);

  assert.doesNotMatch(html, VALUE_LINK_RE);
  assert.match(html, VALUE_TEXT_RE);
  assert.match(html, COPY_BUTTON_SLOT_RE);
});

test("EntryNode address row pins copied feedback on the copy button", () => {
  const html = renderGroups(
    [{ addresses: [PLATFORM_ADDRESS], port: 8080 }],
    "platform"
  );

  assert.match(html, COPIED_PLATFORM_ADDRESS_RE);
});

test("EntryNode draws no group header for a single unnamed port", () => {
  const html = renderGroups([{ addresses: [PLATFORM_ADDRESS], port: 8080 }]);

  assert.doesNotMatch(html, GROUP_HEADER_RE);
  assert.match(html, PUBLIC_ACCESS_LABEL_RE);
  assert.match(html, ONE_ADDRESS_RE);
});

test("EntryNode draws a named header for a single named port", () => {
  const html = renderGroups([
    { addresses: [PLATFORM_ADDRESS], name: "Admin console", port: 8080 },
  ]);

  assert.deepEqual(headerTexts(html), ["Admin console:8080"]);
});

test("EntryNode draws one header per port in the given order", () => {
  const html = renderGroups([
    { addresses: [WS_ADDRESS], name: "game", port: 5200 },
    {
      addresses: [PLATFORM_ADDRESS, { ...PLATFORM_ADDRESS, id: "second" }],
      port: 5201,
    },
  ]);

  assert.equal(html.match(GROUP_HEADER_RE_GLOBAL)?.length, 2);
  assert.deepEqual(headerTexts(html), ["game:5200", ":5201"]);
  assert.equal(html.match(/data-slot="entry-node-address-row"/g)?.length, 3);
});

test("EntryNode header counts every address across groups", () => {
  const html = renderGroups([
    { addresses: [WS_ADDRESS], port: 5200 },
    { addresses: [PLATFORM_ADDRESS], port: 5201 },
  ]);

  assert.match(html, TWO_ADDRESSES_RE);
});

test("EntryNode without groups reads as not configured", () => {
  const html = renderGroups([]);

  assert.match(html, NO_ADDRESSES_RE);
  assert.match(html, NOT_CONFIGURED_RE);
});
