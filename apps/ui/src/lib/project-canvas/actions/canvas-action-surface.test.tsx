import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, Provider as JotaiProvider } from "jotai";
import { renderToStaticMarkup } from "react-dom/server";

import type { CanvasDatabaseNodeData } from "@/lib/project-canvas/nodes/types";
import { CANVAS_ACTION } from "@/store/canvas-store";
import { assistantPaneOpenAtom } from "@/store/layout-store";
import {
  CanvasActionSurface,
  CanvasActionSurfaceFrame,
} from "./canvas-action-surface";

const noop = () => {
  /* test noop */
};

const CLOSE_LABEL_RE = /Close canvas action surface/;
const LABEL_RE = /aria-label="Canvas action surface"/;
const NAME_RE = /orders-db/;
const RESOURCE_PANE_SURFACE_RE = /resource-pane-surface/;
const CANVAS_ACTION_BODY_BACKGROUND_RE =
  /canvas-action-surface-body-background/;
const DATA_BROWSER_RE = /text-resource-pane-foreground/;
const SUBTITLE_RE = /Database PostgreSQL 16.4/;
const ASSISTANT_TOGGLE_OFFSET_RE = /pr-12/;
const CUSTOM_BODY_RE = /Resource logs/;
const CUSTOM_CLOSE_LABEL_RE = /Close logs/;
const CUSTOM_SUBTITLE_RE = /AP · Resource logs/;
const CUSTOM_TITLE_RE = /web Logs/;

const databaseData = {
  connections: [],
  states: {
    displayEngine: "PostgreSQL",
    formattedVersion: "16.4",
    name: "orders-db",
  },
  workload: {
    name: "orders-db",
    namespace: "default",
  },
} satisfies CanvasDatabaseNodeData;

test("canvas action surface renders shared chrome and empty body slot", () => {
  const html = renderToStaticMarkup(
    <CanvasActionSurface
      action={CANVAS_ACTION.dbAccess}
      kubeconfig="kubeconfig"
      namespace="default"
      onClose={noop}
      projectUid="project-uid"
      selectedDatabaseData={databaseData}
    />
  );

  assert.match(html, LABEL_RE);
  assert.match(html, NAME_RE);
  assert.match(html, SUBTITLE_RE);
  assert.match(html, CLOSE_LABEL_RE);
  assert.match(html, RESOURCE_PANE_SURFACE_RE);
  assert.match(html, CANVAS_ACTION_BODY_BACKGROUND_RE);
  assert.match(html, DATA_BROWSER_RE);
});

test("canvas action surface frame renders custom surface content", () => {
  const html = renderToStaticMarkup(
    <CanvasActionSurfaceFrame
      closeAriaLabel="Close logs"
      icon={<span data-testid="logs-icon" />}
      onClose={noop}
      open
      subtitle="AP · Resource logs"
      title="web Logs"
    >
      <p>Resource logs</p>
    </CanvasActionSurfaceFrame>
  );

  assert.match(html, LABEL_RE);
  assert.match(html, CUSTOM_CLOSE_LABEL_RE);
  assert.match(html, CUSTOM_TITLE_RE);
  assert.match(html, CUSTOM_SUBTITLE_RE);
  assert.match(html, CUSTOM_BODY_RE);
  assert.match(html, RESOURCE_PANE_SURFACE_RE);
  assert.match(html, CANVAS_ACTION_BODY_BACKGROUND_RE);
});

test("canvas action surface stays absent without supported action data", () => {
  const html = renderToStaticMarkup(
    <CanvasActionSurface
      action={CANVAS_ACTION.dbAccess}
      kubeconfig="kubeconfig"
      namespace="default"
      onClose={noop}
      projectUid="project-uid"
      selectedDatabaseData={null}
    />
  );

  assert.equal(html, "");
});

test("canvas action surface disables database browser for preview access", () => {
  const html = renderToStaticMarkup(
    <CanvasActionSurface
      action={CANVAS_ACTION.dbAccess}
      dbAccessEnabled={false}
      kubeconfig=""
      namespace="default"
      onClose={noop}
      projectUid="project-uid"
      selectedDatabaseData={databaseData}
    />
  );

  assert.equal(html, "");
});

test("canvas action surface header leaves room for the assistant pane toggle", () => {
  const store = createStore();
  store.set(assistantPaneOpenAtom, false);

  const html = renderToStaticMarkup(
    <JotaiProvider store={store}>
      <CanvasActionSurface
        action={CANVAS_ACTION.dbAccess}
        kubeconfig="kubeconfig"
        namespace="default"
        onClose={noop}
        projectUid="project-uid"
        selectedDatabaseData={databaseData}
      />
    </JotaiProvider>
  );

  assert.match(html, ASSISTANT_TOGGLE_OFFSET_RE);
});
