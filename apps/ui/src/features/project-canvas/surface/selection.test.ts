import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import {
  defaultProjectSideSurfaceForNode,
  findCanvasNodeForProjectTarget,
  projectCanvasSelectionFromNode,
  projectTargetExistsOnCanvas,
} from "./selection";

const apNode = {
  data: {
    states: {
      kind: "AP",
      name: "api",
      namespace: "default",
      uid: "ap-uid",
    },
  },
  id: "ap-api",
  position: { x: 0, y: 0 },
  type: CANVAS_CONTAINER_NODE_TYPE,
} as Node;

const dbNode = {
  data: {
    connections: [],
    states: { name: "pg" },
    uid: "db-uid",
    workload: { name: "pg", namespace: "data" },
  },
  id: "db-pg",
  position: { x: 0, y: 0 },
  type: CANVAS_DATABASE_NODE_TYPE,
} as Node;

const entryNode = {
  data: {
    resource: {
      apRef: "api",
      name: "api-entry",
      namespace: "default",
      uid: "entry-uid",
    },
  },
  id: "entry-api",
  position: { x: 0, y: 0 },
  type: CANVAS_ENTRY_NODE_TYPE,
} as Node;

test("canvas node click selection uses stable resource targets", () => {
  assert.deepEqual(projectCanvasSelectionFromNode(apNode), {
    kind: "resource",
    target: {
      kind: "AP",
      name: "api",
      namespace: "default",
      observedUid: "ap-uid",
    },
  });
  assert.deepEqual(projectCanvasSelectionFromNode(dbNode), {
    kind: "resource",
    target: {
      kind: "DB",
      name: "pg",
      namespace: "data",
      observedUid: "db-uid",
    },
  });
});

test("EntryPoint click selects the AP-bound Public Addresses surface target", () => {
  assert.deepEqual(projectCanvasSelectionFromNode(entryNode), {
    kind: "publicAddresses",
    target: {
      apName: "api",
      kind: "EntryPoint",
      namespace: "default",
      observedUid: "entry-uid",
    },
  });
  assert.deepEqual(defaultProjectSideSurfaceForNode(entryNode), {
    kind: "settings",
    target: {
      kind: "AP",
      name: "api",
      namespace: "default",
    },
    view: "public-addresses",
  });
});

test("AP-bound Public Addresses surface remains meaningful while observed EntryPoint is absent", () => {
  const target = {
    apName: "api",
    kind: "EntryPoint" as const,
    namespace: "default",
  };

  assert.equal(projectTargetExistsOnCanvas([apNode], target), true);
  assert.equal(findCanvasNodeForProjectTarget([apNode], target), null);
});

test("missing AP-bound Public Addresses target clears when the AP disappears", () => {
  assert.equal(
    projectTargetExistsOnCanvas([dbNode], {
      apName: "api",
      kind: "EntryPoint",
      namespace: "default",
    }),
    false
  );
});
