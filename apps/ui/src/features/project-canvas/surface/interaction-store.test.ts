import assert from "node:assert/strict";
import { test } from "node:test";

import type { Edge } from "@xyflow/react";

import {
  createProjectCanvasInteractionStore,
  projectCanvasInteractionAffectedNodeIds,
  selectProjectCanvasNodeInteraction,
} from "./interaction-store";

const apDbEdge = {
  id: "ap-db",
  source: "ap-api",
  target: "db-postgres",
} satisfies Pick<Edge, "id" | "source" | "target">;

test("Project Canvas interaction selector treats selected edge endpoints as selected", () => {
  assert.deepEqual(
    selectProjectCanvasNodeInteraction(
      { connectionOrigin: null, selectedEdge: apDbEdge, selectedNodeId: null },
      "ap-api"
    ),
    { selected: true }
  );
  assert.deepEqual(
    selectProjectCanvasNodeInteraction(
      { connectionOrigin: null, selectedEdge: apDbEdge, selectedNodeId: null },
      "entry-api"
    ),
    { selected: false }
  );
});

test("Project Canvas interaction affected-node selector only reports changed node models", () => {
  assert.deepEqual(
    [
      ...projectCanvasInteractionAffectedNodeIds(
        {
          connectionOrigin: null,
          selectedEdge: null,
          selectedNodeId: "ap-api",
        },
        {
          connectionOrigin: null,
          selectedEdge: null,
          selectedNodeId: "db-postgres",
        }
      ),
    ].sort(),
    ["ap-api", "db-postgres"]
  );

  assert.deepEqual(
    [
      ...projectCanvasInteractionAffectedNodeIds(
        {
          connectionOrigin: { nodeId: "ap-api", side: "right" },
          selectedEdge: null,
          selectedNodeId: null,
        },
        {
          connectionOrigin: { nodeId: "ap-api", side: "right" },
          selectedEdge: null,
          selectedNodeId: null,
        }
      ),
    ],
    []
  );
});

test("Project Canvas interaction store notifies only affected node subscribers", () => {
  const store = createProjectCanvasInteractionStore({
    connectionOrigin: null,
    selectedEdge: null,
    selectedNodeId: "ap-api",
  });
  const apNotifications: unknown[] = [];
  const dbNotifications: unknown[] = [];
  const entryNotifications: unknown[] = [];
  store.subscribeNode("ap-api", () =>
    apNotifications.push(store.getNodeInteraction("ap-api"))
  );
  store.subscribeNode("db-postgres", () =>
    dbNotifications.push(store.getNodeInteraction("db-postgres"))
  );
  store.subscribeNode("entry-api", () =>
    entryNotifications.push(store.getNodeInteraction("entry-api"))
  );

  store.setSnapshot({
    connectionOrigin: { nodeId: "db-postgres", side: "left" },
    selectedEdge: null,
    selectedNodeId: "db-postgres",
  });

  assert.deepEqual(apNotifications, [{ selected: false }]);
  assert.deepEqual(dbNotifications, [
    { highlightedConnectionSide: "left", selected: true },
  ]);
  assert.deepEqual(entryNotifications, []);
});
