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
      owner: {
        kind: "resource",
        ref: { kind: "AP", name: "api", namespace: "default" },
      },
      position: { x: 0, y: 0 },
      stackOrder: 12,
    },
  ],
  projectId: "project-uid",
};

test("canvas layout patch accepts optional finite integer stack order", () => {
  assert.equal(
    parseCanvasLayoutPatchRequest(validPatch).nodes[0]?.stackOrder,
    12
  );
});

test("canvas layout patch requires projectId", () => {
  assert.throws(() =>
    parseCanvasLayoutPatchRequest({
      ...validPatch,
      projectId: undefined,
    })
  );
  assert.equal(
    parseCanvasLayoutPatchRequest(validPatch).projectId,
    "project-uid"
  );
});

test("canvas layout get accepts projectId", () => {
  assert.equal(
    parseCanvasLayoutGetQuery({
      namespace: "default",
      projectId: "project-id",
    }).projectId,
    "project-id"
  );
});

test("canvas layout document accepts projectId", () => {
  assert.equal(
    parseCanvasLayoutDocument({
      ...validPatch,
      version: 1,
    }).projectId,
    "project-uid"
  );
});

test("canvas layout document migrates ref-only legacy nodes to resource owners", () => {
  assert.deepEqual(
    parseCanvasLayoutDocument({
      namespace: "default",
      nodes: [
        {
          expanded: true,
          lastSeenUid: "ap-uid",
          position: { x: 10, y: 20 },
          ref: { kind: "AP", name: "api", namespace: "default" },
          stackOrder: 3,
        },
      ],
      projectId: "project-uid",
      version: 1,
    }).nodes,
    [
      {
        expanded: true,
        lastSeenUid: "ap-uid",
        owner: {
          kind: "resource",
          ref: { kind: "AP", name: "api", namespace: "default" },
        },
        position: { x: 10, y: 20 },
        stackOrder: 3,
      },
    ]
  );
});

test("canvas layout document migrates legacy EntryPoint refs to PublicAccess owners", () => {
  assert.deepEqual(
    parseCanvasLayoutDocument({
      namespace: "default",
      nodes: [
        {
          owner: {
            kind: "resource",
            ref: { kind: "EntryPoint", name: "api", namespace: "default" },
          },
          position: { x: 10, y: 20 },
        },
      ],
      projectId: "project-uid",
      version: 1,
    }).nodes[0]?.owner,
    {
      kind: "resource",
      ref: { kind: "PublicAccess", name: "api", namespace: "default" },
    }
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
