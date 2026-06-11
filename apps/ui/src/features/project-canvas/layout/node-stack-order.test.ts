import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import {
  applyCanvasStackOrderToNodes,
  bringCanvasNodeToFrontInStackOrder,
  nodeWithCanvasStackOrder,
} from "./node-stack-order";

function apNode(name: string): Node {
  return {
    data: { states: { name, namespace: "default" } },
    id: `ap-${name}`,
    position: { x: 0, y: 0 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  };
}

function entryNode(name: string): Node {
  return {
    data: { resource: { name, namespace: "default" } },
    id: `entry-${name}`,
    position: { x: 0, y: 0 },
    type: CANVAS_ENTRY_NODE_TYPE,
  };
}

test("fronting a canvas node updates its local stack order and z-index", () => {
  const result = bringCanvasNodeToFrontInStackOrder(
    [entryNode("api"), apNode("api")],
    "ap-api"
  );

  assert.equal(result.changed, true);
  assert.equal(result.node?.zIndex, 1);
  assert.deepEqual(result.node?.data, {
    layout: { stackOrder: 0 },
    states: { name: "api", namespace: "default" },
  });
});

test("fronting an already-top canvas node does not mutate stack order", () => {
  const result = bringCanvasNodeToFrontInStackOrder(
    [apNode("api"), entryNode("api")],
    "entry-api"
  );

  assert.equal(result.changed, false);
});

test("applying stack order reuses ranked canvas nodes", () => {
  const ranked = applyCanvasStackOrderToNodes([
    entryNode("api"),
    apNode("api"),
  ]);
  const reranked = applyCanvasStackOrderToNodes(ranked);

  assert.equal(reranked, ranked);
  assert.equal(reranked[0], ranked[0]);
  assert.equal(reranked[1], ranked[1]);
});

test("writing an unchanged explicit stack order reuses the canvas node", () => {
  const node = nodeWithCanvasStackOrder(apNode("api"), 3);

  assert.equal(nodeWithCanvasStackOrder(node, 3), node);
});
