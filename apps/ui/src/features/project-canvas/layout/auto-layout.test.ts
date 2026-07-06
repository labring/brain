import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import type { CanvasDetectedConnection } from "../flow/detected-connections";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
} from "../nodes/constants";
import {
  autoLayoutCanvasNodes,
  type CanvasAutoLayoutResult,
} from "./auto-layout";
import { DEPLOYMENT_UNKNOWN_SLOT_ID } from "./placement-owner";
import type { CanvasLayoutPosition } from "./types";

function apNode(
  name: string,
  position: Node["position"],
  layout?: Record<string, unknown>
): Node {
  return {
    data: {
      ...(layout === undefined ? {} : { layout }),
      states: {
        name,
        namespace: "default",
      },
    },
    id: `ap-${name}`,
    position,
    type: CANVAS_CONTAINER_NODE_TYPE,
  };
}

function dbNode(name: string, position: Node["position"]): Node {
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
    position,
    type: CANVAS_DATABASE_NODE_TYPE,
  };
}

function placedDeploymentPlaceholderNode(
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

const apToDbConnection: CanvasDetectedConnection = {
  kind: "APToDB",
  source: { kind: "AP", name: "api", namespace: "default" },
  target: { kind: "DB", name: "postgres", namespace: "default" },
};

function resourceLayoutPositionByName(
  result: CanvasAutoLayoutResult
): Map<string, CanvasLayoutPosition> {
  return new Map(
    result.layoutNodes.flatMap((node) =>
      node.owner.kind === "resource"
        ? [[node.owner.ref.name, node.position] as const]
        : []
    )
  );
}

function movedPosition(
  result: CanvasAutoLayoutResult,
  nodeId: string
): CanvasLayoutPosition | undefined {
  for (const change of result.positionChanges) {
    if (
      change.type === "position" &&
      change.id === nodeId &&
      change.position !== undefined
    ) {
      return change.position;
    }
  }
  return undefined;
}

test("regenerates every position and anchors connected DBs beside their APs", () => {
  const result = autoLayoutCanvasNodes({
    connections: [apToDbConnection],
    nodes: [
      apNode("api", { x: 500, y: 700 }),
      dbNode("postgres", { x: -50, y: 120 }),
    ],
  });

  const positions = resourceLayoutPositionByName(result);
  const apPosition = positions.get("api");
  const dbPosition = positions.get("postgres");
  assert.notEqual(apPosition, undefined);
  assert.deepEqual(dbPosition, {
    x: (apPosition?.x ?? 0) + 340,
    y: apPosition?.y ?? 0,
  });
  assert.equal(result.positionChanges.length, 2);
  assert.deepEqual(movedPosition(result, "ap-api"), apPosition);
  assert.deepEqual(movedPosition(result, "db-postgres"), dbPosition);
  assert.equal(
    result.layoutNodes.every((node) => node.source === "generated"),
    true
  );
});

test("is idempotent once nodes sit at their generated positions", () => {
  const nodes = [
    apNode("api", { x: 500, y: 700 }),
    dbNode("postgres", { x: -50, y: 120 }),
  ];
  const first = autoLayoutCanvasNodes({
    connections: [apToDbConnection],
    nodes,
  });
  const settled = nodes.map((node) => {
    const position = movedPosition(first, node.id);
    return position === undefined ? node : { ...node, position };
  });

  const second = autoLayoutCanvasNodes({
    connections: [apToDbConnection],
    nodes: settled,
  });

  assert.equal(second.positionChanges.length, 0);
  assert.deepEqual(
    resourceLayoutPositionByName(second),
    resourceLayoutPositionByName(first)
  );
});

test("carries expansion and stack order into the persisted layout nodes", () => {
  const result = autoLayoutCanvasNodes({
    nodes: [
      apNode("api", { x: 500, y: 700 }, { expanded: false, stackOrder: 3 }),
    ],
  });

  const [entry] = result.layoutNodes;
  assert.equal(entry?.expanded, false);
  assert.equal(entry?.stackOrder, 3);
  assert.equal(entry?.source, "generated");
});

test("keeps placed deployment placeholders in place and out of the persisted layout", () => {
  const placeholderPosition = { x: 40, y: 60 };
  const result = autoLayoutCanvasNodes({
    nodes: [
      placedDeploymentPlaceholderNode("task-1", placeholderPosition),
      apNode("api", { x: 40, y: 60 }),
    ],
  });

  assert.equal(
    movedPosition(result, "deployment-placeholder-task-1"),
    undefined
  );
  assert.equal(
    result.layoutNodes.some(
      (node) => node.owner.kind === "deploymentProjection"
    ),
    false
  );
  const apPosition = resourceLayoutPositionByName(result).get("api");
  assert.notDeepEqual(apPosition, placeholderPosition);
});
