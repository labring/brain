import assert from "node:assert/strict";
import { test } from "node:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ContainerHistoryPane } from "./container-history-pane";
import type { ContainerHistorySnapshotRow } from "./container-history-pane.types";

const FIRST_IMAGE_RE = /ghcr\.io\/acme\/api:1\.0\.0/;
const SECOND_IMAGE_RE = /ghcr\.io\/acme\/api:0\.9\.0/;
const THIRD_IMAGE_RE = /ghcr\.io\/acme\/api:0\.8\.0/;
const FOURTH_IMAGE_RE = /ghcr\.io\/acme\/api:0\.7\.0/;
const VIEW_ALL_IMAGE_VERSIONS_RE = /aria-label="View All Image Versions"/;
const SHOW_LESS_IMAGE_VERSIONS_RE = /aria-label="Show Less Image Versions"/;
const IMAGE_VERSIONS_COLLAPSED_RE = /aria-expanded="false"/;
const CURSOR_POINTER_RE = /cursor-pointer/;

function rows(count: number): ContainerHistorySnapshotRow[] {
  return Array.from({ length: count }, (_, index) => ({
    createdAt: new Date(Date.UTC(2026, 2, 31 - index)).toISOString(),
    image: `ghcr.io/acme/api:${index === 0 ? "1.0.0" : `0.${10 - index}.0`}`,
    imagePullPolicy: "Always",
    source: "update",
    variant: index === 0 ? "active" : "orphan",
    versionHash: `hash-${index}`,
  }));
}

test("container history pane collapses retained image versions like the domain list", () => {
  const html = renderToStaticMarkup(
    <ContainerHistoryPane rows={rows(4)} workloadName="api" />
  );

  assert.match(html, FIRST_IMAGE_RE);
  assert.match(html, SECOND_IMAGE_RE);
  assert.match(html, THIRD_IMAGE_RE);
  assert.doesNotMatch(html, FOURTH_IMAGE_RE);
  assert.match(html, VIEW_ALL_IMAGE_VERSIONS_RE);
  assert.match(html, IMAGE_VERSIONS_COLLAPSED_RE);
  assert.match(html, CURSOR_POINTER_RE);
  assert.doesNotMatch(html, SHOW_LESS_IMAGE_VERSIONS_RE);
});

test("container history pane omits expansion control for short version history", () => {
  const html = renderToStaticMarkup(
    <ContainerHistoryPane rows={rows(3)} workloadName="api" />
  );

  assert.match(html, FIRST_IMAGE_RE);
  assert.match(html, SECOND_IMAGE_RE);
  assert.match(html, THIRD_IMAGE_RE);
  assert.doesNotMatch(html, VIEW_ALL_IMAGE_VERSIONS_RE);
  assert.doesNotMatch(html, SHOW_LESS_IMAGE_VERSIONS_RE);
});
