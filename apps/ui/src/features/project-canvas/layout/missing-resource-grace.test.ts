import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
  resolveMissingResourceLayoutGrace,
} from "./missing-resource-grace";
import { canvasLayoutNodeKey } from "./placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutResourceKind,
  CanvasResourceLayoutNode,
} from "./types";

function layoutResourceNode(
  kind: CanvasLayoutResourceKind,
  name: string
): CanvasResourceLayoutNode {
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

test("missing resource layout stays retained during local grace", () => {
  const missing = layoutResourceNode("AP", "api");
  const result = resolveMissingResourceLayoutGrace({
    layout: layout([missing]),
    nowMs: 1000,
    resourceIdentities: [],
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

test("missing resource layout stays retained at the grace boundary", () => {
  const missing = layoutResourceNode("DB", "postgres");
  const result = resolveMissingResourceLayoutGrace({
    layout: layout([missing]),
    nowMs: 1000 + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
    previousMissingSinceByOwnerKey: new Map([
      [canvasLayoutNodeKey(missing), 1000],
    ]),
    resourceIdentities: [],
  });

  assert.deepEqual(
    [...result.retainedLayoutOwnerKeys],
    [canvasLayoutNodeKey(missing)]
  );
  assert.deepEqual(result.deleteCommands, []);
});

test("missing resource layout emits delete command after grace", () => {
  const missing = layoutResourceNode("DB", "postgres");
  const result = resolveMissingResourceLayoutGrace({
    layout: layout([missing]),
    nowMs: 1001 + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
    previousMissingSinceByOwnerKey: new Map([
      [canvasLayoutNodeKey(missing), 1000],
    ]),
    resourceIdentities: [],
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
    nowMs: 1000 + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
    previousMissingSinceByOwnerKey: new Map([
      [canvasLayoutNodeKey(api), 1000],
      [canvasLayoutNodeKey(postgres), 1000],
    ]),
    resourceIdentities: [api.owner.ref, postgres.owner.ref],
  });

  assert.deepEqual(result.deleteCommands, []);
  assert.deepEqual([...result.retainedLayoutOwnerKeys], []);
  assert.deepEqual([...result.nextMissingSinceByOwnerKey], []);
});

test("runtime identity keeps presentation-hidden resource layout after grace", () => {
  const api = layoutResourceNode("AP", "api");
  const result = resolveMissingResourceLayoutGrace({
    layout: layout([api]),
    nowMs: 1000 + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS,
    previousMissingSinceByOwnerKey: new Map([[canvasLayoutNodeKey(api), 1000]]),
    resourceIdentities: [api.owner.ref],
  });

  assert.deepEqual(result.deleteCommands, []);
  assert.deepEqual([...result.retainedLayoutOwnerKeys], []);
  assert.deepEqual([...result.nextMissingSinceByOwnerKey], []);
});
