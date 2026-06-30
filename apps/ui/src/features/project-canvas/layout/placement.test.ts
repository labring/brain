import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import {
  isCanvasNodeGeneratedPosition,
  placeCanvasNodes,
  placeCanvasNodesWithLayout,
} from "./placement";
import {
  canvasLayoutNodeKey,
  DEPLOYMENT_UNKNOWN_SLOT_ID,
} from "./placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutResourceKind,
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

function deploymentPlaceholderNode(
  name: string,
  position: Node["position"]
): Node {
  return {
    data: {
      hasProjectionPlacement: true,
      slotId: DEPLOYMENT_UNKNOWN_SLOT_ID,
      taskId: name,
    },
    id: `deployment-placeholder-${name}`,
    position,
    type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  };
}

function deploymentResultPlaceholderNode(
  name: string,
  slotId: string,
  relativePosition: Node["position"],
  position: Node["position"]
): Node {
  return {
    data: {
      groupId: name,
      hasProjectionPlacement: false,
      projectionRelativePlacement: relativePosition,
      projectionSlots: [{ id: slotId }],
      slotId,
      taskId: name,
    },
    id: `deployment-result-placeholder-${name}-${slotId}`,
    position,
    type: CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  };
}

function positionById(nodes: readonly Node[]): Map<string, Node["position"]> {
  return new Map(nodes.map((node) => [node.id, node.position]));
}

function layoutResourceNode(
  kind: CanvasLayoutResourceKind,
  name: string,
  position: Node["position"]
): CanvasLayoutNode {
  return {
    owner: {
      kind: "resource",
      ref: { kind, name, namespace: "default" },
    },
    position,
  };
}

function layoutResourceRef(node: CanvasLayoutNode) {
  return node.owner.kind === "resource" ? node.owner.ref : undefined;
}

test("places an unplaced AP at the fallback grid origin", () => {
  const [node] = placeCanvasNodes({
    layout: undefined,
    nodes: [apNode("api")],
  });

  assert.deepEqual(node?.position, { x: 0, y: 0 });
});

test("places an unanchored node after saved layout when shape remains acceptable", () => {
  const saved = layoutResourceNode("AP", "saved-api", { x: 0, y: 0 });
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [saved],
    projectId: "project-uid",
    version: 1,
  };

  const [node] = placeCanvasNodes({
    layout,
    nodes: [apNode("new-api")],
    retainedLayoutOwnerKeys: new Set([canvasLayoutNodeKey(saved)]),
  });

  assert.deepEqual(node?.position, { x: 340, y: 0 });
});

test("does not reserve missing saved layout nodes outside local grace", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [layoutResourceNode("AP", "saved-api", { x: 0, y: 0 })],
    projectId: "project-uid",
    version: 1,
  };

  const [node] = placeCanvasNodes({
    layout,
    nodes: [apNode("new-api")],
  });

  assert.deepEqual(node?.position, { x: 0, y: 0 });
});

test("treats placed deployment placeholders as placement occupancy", () => {
  const nodes = placeCanvasNodes({
    layout: undefined,
    nodes: [deploymentPlaceholderNode("task-1", { x: 0, y: 0 }), apNode("api")],
  });
  const positions = positionById(nodes);

  assert.deepEqual(positions.get("deployment-placeholder-task-1"), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(positions.get("ap-api"), { x: 340, y: 0 });
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

test("includes last seen UID in first-placement layout nodes", () => {
  const result = placeCanvasNodesWithLayout({
    layout: {
      namespace: "default",
      nodes: [],
      projectId: "project-uid",
      version: 1,
    },
    nodes: [apNode("api", "api-uid")],
  });

  assert.deepEqual(result.placedLayoutNodes[0], {
    expanded: true,
    lastSeenUid: "api-uid",
    owner: {
      kind: "resource",
      ref: { kind: "AP", name: "api", namespace: "default" },
    },
    position: { x: 0, y: 0 },
    source: "generated",
  });
});

test("keeps saved layout positions for detected nodes", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [layoutResourceNode("AP", "api", { x: 512, y: 144 })],
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
    nodes: [layoutResourceNode("AP", "saved-api", { x: 512, y: 144 })],
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

test("anchors an unplaced PublicAccess to the left side of a saved AP", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [layoutResourceNode("AP", "api", { x: 680, y: 280 })],
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

test("uses AABB rectangles from saved and same-run placed nodes during row-major global placement", () => {
  const savedOrigin = layoutResourceNode("AP", "saved-origin", { x: 0, y: 0 });
  const savedOverlap = layoutResourceNode("DB", "saved-overlap", {
    x: 300,
    y: 0,
  });
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [savedOrigin, savedOverlap],
    projectId: "project-uid",
    version: 1,
  };

  const nodes = placeCanvasNodes({
    layout,
    nodes: [apNode("a-api"), apNode("b-api")],
    retainedLayoutOwnerKeys: new Set([
      canvasLayoutNodeKey(savedOrigin),
      canvasLayoutNodeKey(savedOverlap),
    ]),
  });
  const positions = positionById(nodes);

  assert.deepEqual(positions.get("ap-a-api"), { x: 680, y: 0 });
  assert.deepEqual(positions.get("ap-b-api"), { x: 0, y: 280 });
});

test("wraps unanchored global placement before the canvas becomes too wide", () => {
  const first = layoutResourceNode("AP", "first", { x: 0, y: 0 });
  const second = layoutResourceNode("AP", "second", { x: 340, y: 0 });
  const third = layoutResourceNode("AP", "third", { x: 680, y: 0 });
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [first, second, third],
    projectId: "project-uid",
    version: 1,
  };

  const [node] = placeCanvasNodes({
    layout,
    nodes: [dbNode("postgres")],
    retainedLayoutOwnerKeys: new Set([
      canvasLayoutNodeKey(first),
      canvasLayoutNodeKey(second),
      canvasLayoutNodeKey(third),
    ]),
  });

  assert.deepEqual(node?.position, { x: 0, y: 280 });
});

test("places a new AP and PublicAccess as one combined footprint", () => {
  const nodes = placeCanvasNodes({
    layout: undefined,
    nodes: [entryNode("api-entry", "api"), apNode("api")],
  });
  const positions = positionById(nodes);

  assert.deepEqual(positions.get("ap-api"), { x: 340, y: 0 });
  assert.deepEqual(positions.get("entry-api-entry"), { x: 0, y: 0 });
});

test("preserves independent handoff positions for new AP and PublicAccess nodes", () => {
  const result = placeCanvasNodesWithLayout({
    initialPositionByRef: new Map([
      ["AP:default:api", { x: 680, y: 280 }],
      ["PublicAccess:default:api", { x: 120, y: 640 }],
    ]),
    layout: {
      namespace: "default",
      nodes: [],
      projectId: "project-uid",
      version: 1,
    },
    nodes: [entryNode("api-entry", "api"), apNode("api")],
  });
  const positions = positionById(result.nodes);

  assert.deepEqual(positions.get("ap-api"), { x: 680, y: 280 });
  assert.deepEqual(positions.get("entry-api-entry"), { x: 120, y: 640 });
  assert.deepEqual(
    result.placedLayoutNodes.map((node) => ({
      kind: layoutResourceRef(node)?.kind,
      name: layoutResourceRef(node)?.name,
      position: node.position,
    })),
    [
      { kind: "AP", name: "api", position: { x: 680, y: 280 } },
      {
        kind: "PublicAccess",
        name: "api",
        position: { x: 120, y: 640 },
      },
    ]
  );
});

test("places deployment result placeholders as one preview footprint", () => {
  const nodes = placeCanvasNodes({
    layout: undefined,
    nodes: [
      deploymentResultPlaceholderNode(
        "task-1",
        "AP:default:api",
        { x: 340, y: 0 },
        { x: 340, y: 0 }
      ),
      deploymentResultPlaceholderNode(
        "task-1",
        "PublicAccess:default:api",
        { x: 0, y: 0 },
        { x: 0, y: 0 }
      ),
    ],
  });
  const positions = positionById(nodes);

  assert.deepEqual(
    positions.get("deployment-result-placeholder-task-1-AP:default:api"),
    { x: 340, y: 0 }
  );
  assert.deepEqual(
    positions.get(
      "deployment-result-placeholder-task-1-PublicAccess:default:api"
    ),
    { x: 0, y: 0 }
  );
});

test("includes anchored PublicAccess in same-pass placement occupancy", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [layoutResourceNode("AP", "api", { x: 340, y: 0 })],
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

test("moves anchored PublicAccess through local slots to avoid saved occupancy", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [
      layoutResourceNode("AP", "api", { x: 340, y: 0 }),
      layoutResourceNode("DB", "postgres", { x: 0, y: 0 }),
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

test("returns placement group layout nodes for AP and PublicAccess first placement", () => {
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
      kind: layoutResourceRef(node)?.kind,
      name: layoutResourceRef(node)?.name,
      position: node.position,
    })),
    [
      { kind: "AP", name: "api", position: { x: 340, y: 0 } },
      { kind: "PublicAccess", name: "api", position: { x: 0, y: 0 } },
    ]
  );
});

test("anchors new DB nodes to connected AP nodes before global placement", () => {
  const layout: CanvasLayoutDocument = {
    namespace: "default",
    nodes: [layoutResourceNode("AP", "api", { x: 0, y: 0 })],
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
