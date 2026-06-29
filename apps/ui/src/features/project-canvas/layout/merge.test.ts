import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import { mergeCanvasLayoutWithDetectedNodes } from "./merge";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutResourceKind,
  CanvasResourceLayoutNode,
} from "./types";

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

function layoutResourceNode(
  kind: CanvasLayoutResourceKind,
  name: string,
  extra?: Partial<Omit<CanvasResourceLayoutNode, "owner">>
): CanvasLayoutNode {
  return {
    owner: {
      kind: "resource",
      ref: { kind, name, namespace: "default" },
    },
    position: { x: 0, y: 0 },
    ...extra,
  };
}

function layoutResourceName(node: CanvasLayoutNode): string | undefined {
  return node.owner.kind === "resource" ? node.owner.ref.name : undefined;
}

test("merge returns first-placement layout nodes without rewriting loaded layout", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [],
    projectId: "project-uid",
    version: 1,
  };

  const result = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: [apNode("api")],
  });

  assert.equal(result.changed, false);
  assert.deepEqual(result.layout?.nodes, []);
  assert.deepEqual(result.nodes[0]?.position, { x: 0, y: 0 });
  assert.deepEqual(result.placedLayoutNodes, [
    {
      expanded: true,
      owner: {
        kind: "resource",
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
      position: { x: 0, y: 0 },
      source: "generated",
    },
  ]);
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

test("merge reuses nodes that already carry the resolved layout state", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      layoutResourceNode("AP", "api", {
        expanded: false,
        position: { x: 999, y: 999 },
      }),
    ],
    projectId: "project-uid",
    version: 1,
  };
  const [rankedNode] = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: [apNode("api")],
  }).nodes;

  const result = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: rankedNode === undefined ? [] : [rankedNode],
  });

  assert.equal(result.nodes[0], rankedNode);
});

test("merge reuses ranked nodes when layout is unavailable", () => {
  const ranked = mergeCanvasLayoutWithDetectedNodes({
    layout: undefined,
    nodes: [entryNode("api"), apNode("api")],
  }).nodes;
  const reranked = mergeCanvasLayoutWithDetectedNodes({
    layout: undefined,
    nodes: ranked,
  }).nodes;

  assert.equal(reranked, ranked);
  assert.equal(reranked[0], ranked[0]);
  assert.equal(reranked[1], ranked[1]);
});

test("merge does not persist first placements when layout is unavailable", () => {
  const result = mergeCanvasLayoutWithDetectedNodes({
    layout: undefined,
    nodes: [apNode("api")],
  });

  assert.deepEqual(result.nodes[0]?.position, { x: 0, y: 0 });
  assert.deepEqual(result.placedLayoutNodes, []);
});

test("merge lets explicit Canvas Node Stack Order render above default layers", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [layoutResourceNode("AP", "api", { stackOrder: 0 })],
    projectId: "project-uid",
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

test("merge strips legacy orphan timestamp from restored layout nodes", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      layoutResourceNode("AP", "api", {
        lastSeenUid: "api-uid",
        orphanedAt: "2026-05-22T10:00:00.000Z",
        stackOrder: 4,
      }),
    ],
    projectId: "project-uid",
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

test("merge does not treat legacy orphan timestamp as a fronting signal", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      layoutResourceNode("DB", "postgres", { stackOrder: 2 }),
      layoutResourceNode("AP", "api", {
        lastSeenUid: "api-uid",
        orphanedAt: "2026-05-22T10:00:00.000Z",
        stackOrder: 1,
      }),
    ],
    projectId: "project-uid",
    version: 1,
  };

  const result = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: [dbNode("postgres"), apNode("api", "api-uid")],
    now: new Date("2026-05-22T10:00:11.000Z"),
  });

  assert.deepEqual(
    result.layout?.nodes.map((node) => ({
      name: layoutResourceName(node),
      orphanedAt: node.orphanedAt,
      stackOrder: node.stackOrder,
    })),
    [
      { name: "postgres", orphanedAt: undefined, stackOrder: 2 },
      { name: "api", orphanedAt: undefined, stackOrder: 1 },
    ]
  );
  assert.deepEqual(
    result.nodes.map((node) => ({ id: node.id, zIndex: node.zIndex })),
    [
      { id: "db-postgres", zIndex: 1 },
      { id: "ap-api", zIndex: 0 },
    ]
  );
});

test("merge treats same-name different-UID returns as fresh for stack order", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      layoutResourceNode("AP", "api", {
        lastSeenUid: "old-api-uid",
        position: { x: 48, y: 64 },
        stackOrder: 1,
      }),
      layoutResourceNode("DB", "postgres", { stackOrder: 2 }),
    ],
    projectId: "project-uid",
    version: 1,
  };

  const result = mergeCanvasLayoutWithDetectedNodes({
    layout,
    nodes: [apNode("api", "new-api-uid"), dbNode("postgres")],
    now: new Date("2026-05-22T10:00:02.000Z"),
  });

  assert.deepEqual(result.layout?.nodes[0], {
    lastSeenUid: "new-api-uid",
    owner: {
      kind: "resource",
      ref: { kind: "AP", name: "api", namespace: "default" },
    },
    position: { x: 48, y: 64 },
    stackOrder: 3,
  });
});
