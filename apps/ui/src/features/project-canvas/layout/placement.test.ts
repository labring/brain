import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import {
  isCanvasNodeGeneratedPosition,
  placeCanvasNodes,
  placeCanvasNodesWithLayout,
} from "./placement";
import type { CanvasLayoutDocument } from "./types";

function apNode(name: string): Node {
  return {
    data: {
      states: {
        name,
        namespace: "default",
      },
    },
    id: `ap-${name}`,
    position: { x: 999, y: 999 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  };
}

function entryNode(name: string, apRef: string): Node {
  return {
    data: {
      resource: {
        apRef,
        name,
        namespace: "default",
      },
      states: { name },
      targets: [],
    },
    id: `entry-${name}`,
    position: { x: 999, y: 999 },
    type: CANVAS_ENTRY_NODE_TYPE,
  };
}

function dbNode(name: string): Node {
  return {
    data: {
      connections: [],
      states: { name },
      workload: {
        name,
        namespace: "default",
      },
    },
    id: `db-${name}`,
    position: { x: 999, y: 999 },
    type: CANVAS_DATABASE_NODE_TYPE,
  };
}

function positionById(nodes: readonly Node[]): Map<string, Node["position"]> {
  return new Map(nodes.map((node) => [node.id, node.position]));
}

test("places an unplaced AP at the fallback grid origin", () => {
  const [node] = placeCanvasNodes({
    layout: undefined,
    nodes: [apNode("api")],
  });

  assert.deepEqual(node?.position, { x: 0, y: 0 });
});

test("places unanchored nodes in the global block to the right of saved layout", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 0, y: 0 },
        ref: { kind: "AP", name: "saved-api", namespace: "default" },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };

  const [node] = placeCanvasNodes({
    layout,
    nodes: [apNode("new-api")],
  });

  assert.deepEqual(node?.position, { x: 340, y: 0 });
});

test("places unplaced nodes in kind namespace name lexicographic order", () => {
  const nodes = placeCanvasNodes({
    layout: undefined,
    nodes: [apNode("z-api"), apNode("a-api")],
  });
  const positions = positionById(nodes);

  assert.deepEqual(positions.get("ap-a-api"), { x: 0, y: 0 });
  assert.deepEqual(positions.get("ap-z-api"), { x: 340, y: 0 });
});

test("returns newly placed layout nodes for first placement persistence", () => {
  const result = placeCanvasNodesWithLayout({
    layout: {
      namespace: "default",
      nodes: [],
      projectId: "project-uid",
      version: 1,
    },
    nodes: [apNode("api")],
  });

  assert.deepEqual(result.placedLayoutNodes, [
    {
      expanded: false,
      position: { x: 0, y: 0 },
      ref: { kind: "AP", name: "api", namespace: "default" },
    },
  ]);
});

test("keeps saved layout positions for detected nodes", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 512, y: 144 },
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };

  const [node] = placeCanvasNodes({
    layout,
    nodes: [apNode("api")],
  });

  assert.deepEqual(node?.position, { x: 512, y: 144 });
});

test("marks only in-memory generated positions as viewport follow targets", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 512, y: 144 },
        ref: { kind: "AP", name: "saved-api", namespace: "default" },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };

  const nodes = placeCanvasNodes({
    layout,
    nodes: [apNode("new-api"), apNode("saved-api")],
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));

  assert.equal(isCanvasNodeGeneratedPosition(byId.get("ap-new-api")), true);
  assert.equal(isCanvasNodeGeneratedPosition(byId.get("ap-saved-api")), false);
});

test("anchors an unplaced EntryPoint to the left side of a saved AP", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 680, y: 280 },
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };

  const nodes = placeCanvasNodes({
    layout,
    nodes: [apNode("api"), entryNode("api-entry", "api")],
  });
  const positions = positionById(nodes);

  assert.deepEqual(positions.get("entry-api-entry"), { x: 340, y: 280 });
});

test("uses AABB rectangles from saved and same-run placed nodes during global block placement", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 0, y: 0 },
        ref: { kind: "AP", name: "saved-origin", namespace: "default" },
      },
      {
        position: { x: 300, y: 0 },
        ref: { kind: "DB", name: "saved-overlap", namespace: "default" },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };

  const nodes = placeCanvasNodes({
    layout,
    nodes: [apNode("a-api"), apNode("b-api")],
  });
  const positions = positionById(nodes);

  assert.deepEqual(positions.get("ap-a-api"), { x: 680, y: 0 });
  assert.deepEqual(positions.get("ap-b-api"), { x: 1020, y: 0 });
});

test("fills the right-side global placement block before moving rows", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 0, y: 0 },
        ref: { kind: "AP", name: "first", namespace: "default" },
      },
      {
        position: { x: 340, y: 0 },
        ref: { kind: "AP", name: "second", namespace: "default" },
      },
      {
        position: { x: 680, y: 0 },
        ref: { kind: "AP", name: "third", namespace: "default" },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };

  const [node] = placeCanvasNodes({
    layout,
    nodes: [dbNode("postgres")],
  });

  assert.deepEqual(node?.position, { x: 1020, y: 0 });
});

test("anchors an EntryPoint to its AP after the AP receives a fallback slot", () => {
  const nodes = placeCanvasNodes({
    layout: undefined,
    nodes: [entryNode("api-entry", "api"), apNode("api")],
  });
  const positions = positionById(nodes);

  assert.deepEqual(positions.get("ap-api"), { x: 0, y: 0 });
  assert.deepEqual(positions.get("entry-api-entry"), { x: -340, y: 0 });
});

test("includes anchored EntryPoints in same-pass placement occupancy", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 340, y: 0 },
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };

  const nodes = placeCanvasNodes({
    layout,
    nodes: [apNode("api"), entryNode("api-entry", "api"), dbNode("postgres")],
  });
  const positions = positionById(nodes);

  assert.deepEqual(positions.get("entry-api-entry"), { x: 0, y: 0 });
  assert.notDeepEqual(positions.get("db-postgres"), { x: 0, y: 0 });
});

test("moves anchored EntryPoints through local slots to avoid saved occupancy", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 340, y: 0 },
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
      {
        position: { x: 0, y: 0 },
        ref: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };

  const nodes = placeCanvasNodes({
    layout,
    nodes: [apNode("api"), entryNode("api-entry", "api"), dbNode("postgres")],
  });
  const positions = positionById(nodes);

  assert.deepEqual(positions.get("entry-api-entry"), { x: 0, y: -280 });
  assert.deepEqual(positions.get("db-postgres"), { x: 0, y: 0 });
});

test("returns placement group layout nodes for AP and EntryPoint first placement", () => {
  const result = placeCanvasNodesWithLayout({
    layout: {
      namespace: "default",
      nodes: [],
      projectId: "project-uid",
      version: 1,
    },
    nodes: [entryNode("api-entry", "api"), apNode("api")],
  });

  assert.deepEqual(
    result.placedLayoutNodes.map((node) => ({
      kind: node.ref.kind,
      name: node.ref.name,
      position: node.position,
    })),
    [
      { kind: "AP", name: "api", position: { x: 0, y: 0 } },
      { kind: "EntryPoint", name: "api", position: { x: -340, y: 0 } },
    ]
  );
});

test("anchors new DB nodes to connected AP nodes before global placement", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 0, y: 0 },
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
    ],
    projectId: "project-uid",
    version: 1,
  };

  const [node] = placeCanvasNodes({
    connections: [
      {
        kind: "APToDB",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ],
    layout,
    nodes: [dbNode("postgres")],
  });

  assert.deepEqual(node?.position, { x: 340, y: 0 });
});
