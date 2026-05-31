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
    projectUid: "project-uid",
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
