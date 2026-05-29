import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  normalizeCanvasActionMode,
  shouldClearCanvasActionMode,
} from "@/lib/project-canvas/actions/canvas-action-mode";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/lib/project-canvas/nodes/constants";
import {
  databasePaneModeForNodeClick,
  normalizeDatabasePaneMode,
  shouldClearDatabasePaneMode,
} from "@/lib/project-canvas/panels/database-panel-mode";
import {
  entryPaneModeForNodeClick,
  normalizeEntryPaneMode,
} from "@/lib/project-canvas/panels/entrypoint-panel-mode";
import {
  normalizeWorkloadPaneMode,
  shouldClearWorkloadPaneMode,
  workloadPaneModeForNodeClick,
} from "@/lib/project-canvas/panels/workload-pane-mode";
import { projectCanvasNodeServiceUid } from "./canvas-store";

test("projectCanvasNodeServiceUid derives EntryPoint AP-bound Surface Key", () => {
  const node = {
    data: {
      resource: {
        apRef: "web",
        name: "web-entry",
        namespace: "default",
        uid: "entrypoint-uid",
      },
    },
    id: "entry-web",
    position: { x: 0, y: 0 },
    type: CANVAS_ENTRY_NODE_TYPE,
  } as Node;

  assert.equal(projectCanvasNodeServiceUid(node), "entry:default:web");
});

test("projectCanvasNodeServiceUid prefers EntryPoint selection key", () => {
  const node = {
    data: {
      resource: {
        name: "web-entry",
        namespace: "default",
        selectionKey: "entry:default:web",
        uid: "entrypoint-uid",
      },
    },
    id: "entry-web",
    position: { x: 0, y: 0 },
    type: CANVAS_ENTRY_NODE_TYPE,
  } as Node;

  assert.equal(projectCanvasNodeServiceUid(node), "entry:default:web");
});

test("database panel mode distinguishes settings and metrics URL values", () => {
  assert.equal(normalizeDatabasePaneMode("settings"), "settings");
  assert.equal(normalizeDatabasePaneMode("metrics"), "metrics");
  assert.equal(normalizeDatabasePaneMode("logs"), "logs");
  assert.equal(normalizeDatabasePaneMode("console"), "console");
  assert.equal(normalizeDatabasePaneMode("terminal"), null);
});

test("database node selection opens settings mode and non-DB selection clears it", () => {
  assert.equal(
    databasePaneModeForNodeClick({ type: CANVAS_DATABASE_NODE_TYPE }),
    "settings"
  );
  assert.equal(
    databasePaneModeForNodeClick({ type: CANVAS_CONTAINER_NODE_TYPE }),
    null
  );
});

test("workload panel mode distinguishes AP pane URL values", () => {
  assert.equal(normalizeWorkloadPaneMode("settings"), "settings");
  assert.equal(normalizeWorkloadPaneMode("metrics"), "metrics");
  assert.equal(normalizeWorkloadPaneMode("logs"), "logs");
  assert.equal(normalizeWorkloadPaneMode("history"), "history");
  assert.equal(normalizeWorkloadPaneMode("terminal"), "terminal");
  assert.equal(normalizeWorkloadPaneMode("Settings"), null);
});

test("entry panel mode only accepts settings URL value", () => {
  assert.equal(normalizeEntryPaneMode("settings"), "settings");
  assert.equal(normalizeEntryPaneMode("metrics"), null);
});

test("canvas action mode accepts DB access URL value", () => {
  assert.equal(normalizeCanvasActionMode("dbAccess"), "dbAccess");
  assert.equal(normalizeCanvasActionMode("metrics"), null);
});

test("container node selection opens settings mode and non-container selection clears it", () => {
  assert.equal(
    workloadPaneModeForNodeClick({ type: CANVAS_CONTAINER_NODE_TYPE }),
    "settings"
  );
  assert.equal(
    workloadPaneModeForNodeClick({ type: CANVAS_DATABASE_NODE_TYPE }),
    null
  );
});

test("entry node selection opens EntryPoint settings mode", () => {
  assert.equal(
    entryPaneModeForNodeClick({ type: CANVAS_ENTRY_NODE_TYPE }),
    "settings"
  );
  assert.equal(
    entryPaneModeForNodeClick({ type: CANVAS_CONTAINER_NODE_TYPE }),
    null
  );
});

test("database panel mode cleanup handles stale and non-DB selections", () => {
  assert.equal(
    shouldClearDatabasePaneMode({
      databasePane: "settings",
      rawNodeCount: 2,
      selectedNode: null,
      serviceUid: "stale-db-uid",
    }),
    true
  );
  assert.equal(
    shouldClearDatabasePaneMode({
      databasePane: "metrics",
      rawNodeCount: 2,
      selectedNode: { type: CANVAS_CONTAINER_NODE_TYPE },
      serviceUid: "ap-uid",
    }),
    true
  );
  assert.equal(
    shouldClearDatabasePaneMode({
      databasePane: "settings",
      rawNodeCount: 2,
      selectedNode: { type: CANVAS_DATABASE_NODE_TYPE },
      serviceUid: "db-uid",
    }),
    false
  );
});

test("workload panel mode cleanup handles stale and non-container selections", () => {
  assert.equal(
    shouldClearWorkloadPaneMode({
      rawNodeCount: 2,
      selectedNode: null,
      serviceUid: "stale-ap-uid",
      workloadPane: "settings",
    }),
    true
  );
  assert.equal(
    shouldClearWorkloadPaneMode({
      rawNodeCount: 2,
      selectedNode: { type: CANVAS_DATABASE_NODE_TYPE },
      serviceUid: "db-uid",
      workloadPane: "metrics",
    }),
    true
  );
  assert.equal(
    shouldClearWorkloadPaneMode({
      rawNodeCount: 2,
      selectedNode: { type: CANVAS_CONTAINER_NODE_TYPE },
      serviceUid: "ap-uid",
      workloadPane: "history",
    }),
    false
  );
});

test("canvas action mode cleanup handles stale and unsupported selections", () => {
  assert.equal(
    shouldClearCanvasActionMode({
      canvasAction: "dbAccess",
      rawNodeCount: 2,
      selectedNode: null,
      serviceUid: "stale-db-uid",
    }),
    true
  );
  assert.equal(
    shouldClearCanvasActionMode({
      canvasAction: "dbAccess",
      rawNodeCount: 2,
      selectedNode: { type: CANVAS_CONTAINER_NODE_TYPE },
      serviceUid: "ap-uid",
    }),
    true
  );
  assert.equal(
    shouldClearCanvasActionMode({
      canvasAction: "dbAccess",
      rawNodeCount: 2,
      selectedNode: { type: CANVAS_DATABASE_NODE_TYPE },
      serviceUid: "db-uid",
    }),
    false
  );
});
