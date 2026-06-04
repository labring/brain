import assert from "node:assert/strict";
import { test } from "node:test";

import {
  parseCanvasLayoutDocument,
  parseCanvasLayoutGetQuery,
  parseCanvasLayoutPatchRequest,
} from "./contract";

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

test("canvas layout patch normalizes projectId and legacy projectUid", () => {
  assert.equal(
    parseCanvasLayoutPatchRequest({
      ...validPatch,
      projectId: "project-id",
      projectUid: undefined,
    }).projectUid,
    "project-id"
  );
  assert.equal(
    parseCanvasLayoutPatchRequest(validPatch).projectId,
    "project-uid"
  );
});

test("canvas layout get accepts projectId without legacy projectUid", () => {
  assert.equal(
    parseCanvasLayoutGetQuery({
      namespace: "default",
      projectId: "project-id",
    }).projectUid,
    "project-id"
  );
});

test("canvas layout document normalizes projectId from legacy projectUid", () => {
  assert.equal(
    parseCanvasLayoutDocument({
      ...validPatch,
      version: 1,
    }).projectId,
    "project-uid"
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
