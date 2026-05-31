import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import { mergeCanvasLayoutWithDetectedNodes } from "./merge";
import type { CanvasLayoutDocument } from "./types";

function apNode(name: string, uid?: string): Node {
  return {
    data: {
      states: {
        name,
        namespace: "default",
        ...(uid === undefined ? {} : { uid }),
      },
    },
    id: `ap-${name}`,
    position: { x: 999, y: 999 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  };
}

function dbNode(name: string): Node {
  return {
    data: {
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

function entryNode(name: string, apRef = "api"): Node {
  return {
    data: {
      resource: {
        apRef,
        name,
        namespace: "default",
      },
    },
    id: `entry-${name}`,
    position: { x: 999, y: 999 },
    type: CANVAS_ENTRY_NODE_TYPE,
  };
}

test("merge places unplaced nodes in memory without adding them to Canvas Layout", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [],
    projectUid: "project-uid",
    version: 1,
  };

  const result = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: [apNode("api")],
  });

  assert.equal(result.changed, false);
  assert.deepEqual(result.layout?.nodes, []);
  assert.deepEqual(result.nodes[0]?.position, { x: 0, y: 0 });
});

test("merge exposes default Canvas Node Stack Order as React Flow z-index", () => {
  const result = mergeCanvasLayoutWithDetectedNodes({
    layout: undefined,
    nodes: [entryNode("api"), apNode("api"), dbNode("postgres")],
  });

  assert.deepEqual(
    result.nodes.map((node) => ({ id: node.id, zIndex: node.zIndex })),
    [
      { id: "entry-api", zIndex: 2 },
      { id: "ap-api", zIndex: 0 },
      { id: "db-postgres", zIndex: 1 },
    ]
  );
});

test("merge lets explicit Canvas Node Stack Order render above default layers", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 0, y: 0 },
        ref: { kind: "AP", name: "api", namespace: "default" },
        stackOrder: 0,
      },
    ],
    projectUid: "project-uid",
    version: 1,
  };

  const result = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: [entryNode("api"), apNode("api")],
  });

  assert.deepEqual(
    result.nodes.map((node) => ({ id: node.id, zIndex: node.zIndex })),
    [
      { id: "entry-api", zIndex: 0 },
      { id: "ap-api", zIndex: 1 },
    ]
  );
});

test("merge restores stack order for brief orphan returns", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        lastSeenUid: "api-uid",
        orphanedAt: "2026-05-22T10:00:00.000Z",
        position: { x: 0, y: 0 },
        ref: { kind: "AP", name: "api", namespace: "default" },
        stackOrder: 4,
      },
    ],
    projectUid: "project-uid",
    version: 1,
  };

  const result = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: [apNode("api", "api-uid")],
    now: new Date("2026-05-22T10:00:05.000Z"),
  });

  assert.equal(result.layout?.nodes[0]?.orphanedAt, undefined);
  assert.equal(result.layout?.nodes[0]?.stackOrder, 4);
  assert.equal(result.nodes[0]?.zIndex, 0);
});

test("merge brings meaningful orphan returns to the front", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        position: { x: 0, y: 0 },
        ref: { kind: "DB", name: "postgres", namespace: "default" },
        stackOrder: 2,
      },
      {
        lastSeenUid: "api-uid",
        orphanedAt: "2026-05-22T10:00:00.000Z",
        position: { x: 0, y: 0 },
        ref: { kind: "AP", name: "api", namespace: "default" },
        stackOrder: 1,
      },
    ],
    projectUid: "project-uid",
    version: 1,
  };

  const result = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: [dbNode("postgres"), apNode("api", "api-uid")],
    now: new Date("2026-05-22T10:00:11.000Z"),
  });

  assert.deepEqual(
    result.layout?.nodes.map((node) => ({
      name: node.ref.name,
      stackOrder: node.stackOrder,
    })),
    [
      { name: "postgres", stackOrder: 2 },
      { name: "api", stackOrder: 3 },
    ]
  );
  assert.deepEqual(
    result.nodes.map((node) => ({ id: node.id, zIndex: node.zIndex })),
    [
      { id: "db-postgres", zIndex: 0 },
      { id: "ap-api", zIndex: 1 },
    ]
  );
});

test("merge treats same-name different-UID returns as fresh for stack order", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      {
        lastSeenUid: "old-api-uid",
        orphanedAt: "2026-05-22T10:00:00.000Z",
        position: { x: 48, y: 64 },
        ref: { kind: "AP", name: "api", namespace: "default" },
        stackOrder: 1,
      },
      {
        position: { x: 0, y: 0 },
        ref: { kind: "DB", name: "postgres", namespace: "default" },
        stackOrder: 2,
      },
    ],
    projectUid: "project-uid",
    version: 1,
  };

  const result = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: [apNode("api", "new-api-uid"), dbNode("postgres")],
    now: new Date("2026-05-22T10:00:02.000Z"),
  });

  assert.deepEqual(result.layout?.nodes[0], {
    lastSeenUid: "new-api-uid",
    position: { x: 48, y: 64 },
    ref: { kind: "AP", name: "api", namespace: "default" },
    stackOrder: 3,
  });
});
