import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
} from "../nodes/constants";
import {
  CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
  resolveMissingResourceLayoutGrace,
} from "./missing-resource-grace";
import { canvasLayoutNodeKey } from "./placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutResourceKind,
} from "./types";

function layoutResourceNode(
  kind: CanvasLayoutResourceKind,
  name: string
): CanvasLayoutNode {
  return {
    owner: {
      kind: "resource",
      ref: { kind, name, namespace: "default" },
    },
    position: { x: 0, y: 0 },
  };
}

function layout(nodes: CanvasLayoutNode[]): CanvasLayoutDocument {
  return {
    namespace: "default",
    nodes,
    projectId: "project-uid",
    version: 1,
  };
}

function apNode(name: string): Node {
  return {
    data: { states: { name, namespace: "default" } },
    id: `ap-${name}`,
    position: { x: 0, y: 0 },
    type: CANVAS_CONTAINER_NODE_TYPE,
  };
}

function dbNode(name: string): Node {
  return {
    data: { workload: { name, namespace: "default" } },
    id: `db-${name}`,
    position: { x: 0, y: 0 },
    type: CANVAS_DATABASE_NODE_TYPE,
  };
}

test("missing resource layout stays retained during local grace", () => {
  const missing = layoutResourceNode("AP", "api");
  const result = resolveMissingResourceLayoutGrace({
    layout: layout([missing]),
    nodes: [],
    nowMs: 1000,
  });

  assert.deepEqual(result.deleteCommands, []);
  assert.deepEqual(
    [...result.retainedLayoutOwnerKeys],
    [canvasLayoutNodeKey(missing)]
  );
  assert.deepEqual(
    [...result.nextMissingSinceByOwnerKey.entries()],
    [[canvasLayoutNodeKey(missing), 1000]]
  );
});

test("missing resource layout emits delete command after grace", () => {
  const missing = layoutResourceNode("DB", "postgres");
  const result = resolveMissingResourceLayoutGrace({
    layout: layout([missing]),
    nodes: [],
    nowMs: 1000 + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
    previousMissingSinceByOwnerKey: new Map([
      [canvasLayoutNodeKey(missing), 1000],
    ]),
  });

  assert.deepEqual([...result.retainedLayoutOwnerKeys], []);
  assert.deepEqual(result.deleteCommands, [
    {
      kind: "delete",
      owner: {
        kind: "resource",
        ref: { kind: "DB", name: "postgres", namespace: "default" },
      },
    },
  ]);
});

test("detected resources clear missing layout grace state", () => {
  const api = layoutResourceNode("AP", "api");
  const postgres = layoutResourceNode("DB", "postgres");
  const result = resolveMissingResourceLayoutGrace({
    layout: layout([api, postgres]),
    nodes: [apNode("api"), dbNode("postgres")],
    nowMs: 1000 + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
    previousMissingSinceByOwnerKey: new Map([
      [canvasLayoutNodeKey(api), 1000],
      [canvasLayoutNodeKey(postgres), 1000],
    ]),
  });

  assert.deepEqual(result.deleteCommands, []);
  assert.deepEqual([...result.retainedLayoutOwnerKeys], []);
  assert.deepEqual([...result.nextMissingSinceByOwnerKey], []);
});
