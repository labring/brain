import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCanvasLayoutPatchRequest } from "./contract";

const validPatch = {
  namespace: "default",
  nodes: [
    {
      position: { x: 0, y: 0 },
      ref: { kind: "AP", name: "api", namespace: "default" },
      stackOrder: 12,
    },
  ],
  projectUid: "project-uid",
};

test("canvas layout patch accepts optional finite integer stack order", () => {
  assert.equal(
    parseCanvasLayoutPatchRequest(validPatch).nodes[0]?.stackOrder,
    12
  );
});

test("canvas layout patch rejects malformed stack order", () => {
  assert.throws(() =>
    parseCanvasLayoutPatchRequest({
      ...validPatch,
      nodes: [{ ...validPatch.nodes[0], stackOrder: 1.5 }],
    })
  );
  assert.throws(() =>
    parseCanvasLayoutPatchRequest({
      ...validPatch,
      nodes: [{ ...validPatch.nodes[0], stackOrder: Number.NaN }],
    })
  );
});
