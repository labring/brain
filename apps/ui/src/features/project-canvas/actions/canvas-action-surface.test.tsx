import assert from "node:assert/strict";
import { test } from "node:test";
import { createStore, Provider as JotaiProvider } from "jotai";
import { renderToStaticMarkup } from "react-dom/server";

import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import { assistantPaneOpenAtom } from "@/store/layout-store";
import {
  MainActionSurface,
  MainActionSurfaceFrame,
} from "./canvas-action-surface";

const noop = () => {
  /* test noop */
};

const CLOSE_LABEL_RE = /Close Main Action Surface/;
const LABEL_RE = /aria-label="Main Action Surface"/;
const NAME_RE = /orders-db/;
const RESOURCE_PANE_SURFACE_RE = /resource-pane-surface/;
const MAIN_ACTION_BODY_BACKGROUND_RE = /main-action-surface-body-background/;
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

test("main action surface renders shared chrome and empty body slot", () => {
  const html = renderToStaticMarkup(
    <MainActionSurface
      entry={{
        kind: "dbAccess",
        target: { kind: "DB", name: "orders-db", namespace: "default" },
      }}
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
  assert.match(html, MAIN_ACTION_BODY_BACKGROUND_RE);
  assert.match(html, DATA_BROWSER_RE);
});

test("main action surface frame renders custom surface content", () => {
  const html = renderToStaticMarkup(
    <MainActionSurfaceFrame
      closeAriaLabel="Close logs"
      icon={<span data-testid="logs-icon" />}
      onClose={noop}
      open
      subtitle="AP · Resource logs"
      title="web Logs"
    >
      <p>Resource logs</p>
    </MainActionSurfaceFrame>
  );

  assert.match(html, LABEL_RE);
  assert.match(html, CUSTOM_CLOSE_LABEL_RE);
  assert.match(html, CUSTOM_TITLE_RE);
  assert.match(html, CUSTOM_SUBTITLE_RE);
  assert.match(html, CUSTOM_BODY_RE);
  assert.match(html, RESOURCE_PANE_SURFACE_RE);
  assert.match(html, MAIN_ACTION_BODY_BACKGROUND_RE);
});

test("main action surface stays absent without supported entry data", () => {
  const html = renderToStaticMarkup(
    <MainActionSurface
      entry={{
        kind: "dbAccess",
        target: { kind: "DB", name: "orders-db", namespace: "default" },
      }}
      kubeconfig="kubeconfig"
      namespace="default"
      onClose={noop}
      projectUid="project-uid"
      selectedDatabaseData={null}
    />
  );

  assert.equal(html, "");
});

test("main action surface disables database browser when requested", () => {
  const html = renderToStaticMarkup(
    <MainActionSurface
      dbAccessEnabled={false}
      entry={{
        kind: "dbAccess",
        target: { kind: "DB", name: "orders-db", namespace: "default" },
      }}
      kubeconfig=""
      namespace="default"
      onClose={noop}
      projectUid="project-uid"
      selectedDatabaseData={databaseData}
    />
  );

  assert.equal(html, "");
});

test("main action surface header leaves room for the assistant pane toggle", () => {
  const store = createStore();
  store.set(assistantPaneOpenAtom, false);

  const html = renderToStaticMarkup(
    <JotaiProvider store={store}>
      <MainActionSurface
        entry={{
          kind: "dbAccess",
          target: { kind: "DB", name: "orders-db", namespace: "default" },
        }}
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
