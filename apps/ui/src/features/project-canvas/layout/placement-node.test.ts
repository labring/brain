import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
} from "../nodes/constants";
import {
  CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED,
  CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED,
} from "./placement-geometry";
import {
  layoutNodeFootprintHeight,
  nodeFootprintHeight,
} from "./placement-node";
import type { CanvasLayoutNode } from "./types";

test("resource canvas nodes default to expanded footprint height", () => {
  const node: Node = {
    data: {},
    id: "ap-api",
    position: { x: 0, y: 0 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  };
  const layoutNode: CanvasLayoutNode = {
    owner: {
      kind: "resource",
      ref: { kind: "AP", name: "api", namespace: "default" },
    },
    position: { x: 0, y: 0 },
  };

  assert.equal(
    nodeFootprintHeight(node),
    CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED
  );
  assert.equal(
    layoutNodeFootprintHeight(layoutNode),
    CANVAS_NODE_FOOTPRINT_HEIGHT_EXPANDED
  );
});

test("measured height wins over the expansion fallback", () => {
  const node: Node = {
    data: {},
    id: "ap-api",
    measured: { height: 123, width: 272 },
    position: { x: 0, y: 0 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  };

  assert.equal(nodeFootprintHeight(node), 123);
});

test("non-resource projection nodes keep collapsed footprint by default", () => {
  const node: Node = {
    data: { taskId: "task-1" },
    id: "deployment-placeholder-task-1",
    position: { x: 0, y: 0 },
    type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  };
  const layoutNode: CanvasLayoutNode = {
    owner: {
      kind: "deploymentProjection",
      slotId: "unknown",
      taskId: "task-1",
    },
    position: { x: 0, y: 0 },
  };

  assert.equal(
    nodeFootprintHeight(node),
    CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED
  );
  assert.equal(
    layoutNodeFootprintHeight(layoutNode),
    CANVAS_NODE_FOOTPRINT_HEIGHT_COLLAPSED
  );
});
