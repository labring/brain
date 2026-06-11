import assert from "node:assert/strict";
import { test } from "node:test";

import { applyCanvasLayoutPatch, CanvasLayoutValidationError } from "./patch";
import type { CanvasLayoutDocument, CanvasLayoutNode } from "./types";

function node(
  name: string,
  stackOrder?: number,
  extra?: Partial<CanvasLayoutNode>
): CanvasLayoutNode {
  return {
    position: { x: 0, y: 0 },
    ref: { kind: "AP", name, namespace: "default" },
    ...(stackOrder === undefined ? {} : { stackOrder }),
    ...extra,
  };
}

function layout(nodes: CanvasLayoutNode[]): CanvasLayoutDocument {
  return {
    namespace: "default",
    nodes,
    projectId: "project-uid",
    version: 0,
  };
}

test("canvas layout patch normalizes explicit stack order ranks before storage", () => {
  const result = applyCanvasLayoutPatch(
    layout([node("api", 50), node("worker")]),
    { nodes: [node("worker", 100)] }
  );

  assert.deepEqual(
    result.nodes.map((item) => ({
      name: item.ref.name,
      stackOrder: item.stackOrder,
    })),
    [
      { name: "api", stackOrder: 0 },
      { name: "worker", stackOrder: 1 },
    ]
  );
});

test("canvas layout patch rejects non-integer stack order values", () => {
  assert.throws(
    () => applyCanvasLayoutPatch(layout([]), { nodes: [node("api", 1.5)] }),
    CanvasLayoutValidationError
  );
});

test("first placement patch inserts missing nodes without overwriting saved positions", () => {
  const result = applyCanvasLayoutPatch(
    layout([node("api", undefined, { position: { x: 10, y: 20 } })]),
    {
      intent: "first-placement",
      nodes: [
        node("api", undefined, { position: { x: 999, y: 999 } }),
        node("worker", undefined, { position: { x: 340, y: 0 } }),
      ],
    }
  );

  assert.deepEqual(
    result.nodes.map((item) => ({
      name: item.ref.name,
      position: item.position,
    })),
    [
      { name: "api", position: { x: 10, y: 20 } },
      { name: "worker", position: { x: 340, y: 0 } },
    ]
  );
});

test("first placement patch does not overwrite an existing layout node", () => {
  const result = applyCanvasLayoutPatch(
    layout([node("api", undefined, { position: { x: 48, y: 64 } })]),
    {
      intent: "first-placement",
      nodes: [node("api", undefined, { position: { x: 999, y: 999 } })],
    }
  );

  assert.deepEqual(result.nodes[0]?.position, { x: 48, y: 64 });
  assert.equal(result.version, 0);
});

test("first placement patch inserts missing layout nodes", () => {
  const result = applyCanvasLayoutPatch(layout([]), {
    intent: "first-placement",
    nodes: [node("api", undefined, { position: { x: 340, y: 0 } })],
  });

  assert.deepEqual(result.nodes[0]?.position, { x: 340, y: 0 });
});
