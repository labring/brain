import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
} from "../nodes/constants";
import {
  addPendingApDbCanvasReferences,
  pendingApDbCanvasConnectionEdges,
  removePendingApDbCanvasReferences,
} from "./pending-connections";

const apNode = {
  data: { states: { kind: "AP", name: "api", namespace: "default" } },
  id: "ap-api",
  position: { x: 0, y: 0 },
  type: CANVAS_CONTAINER_NODE_TYPE,
} satisfies Node;

const dbNode = {
  data: { workload: { name: "postgres", namespace: "default" } },
  id: "db-postgres",
  position: { x: 320, y: 0 },
  type: CANVAS_DATABASE_NODE_TYPE,
} satisfies Node;

test("pending AP-DB canvas references render a client-only edge for the confirmed pair", () => {
  assert.deepEqual(
    pendingApDbCanvasConnectionEdges({
      nodes: [apNode, dbNode],
      pendingReferences: [
        {
          id: "intent-1",
          source: { kind: "AP", name: "api", namespace: "default" },
          target: { kind: "DB", name: "postgres", namespace: "default" },
        },
      ],
    }),
    [
      {
        data: { pending: true },
        id: "pending:AP:default:api->DB:default:postgres",
        source: "ap-api",
        target: "db-postgres",
      },
    ]
  );
});

test("pending AP-DB canvas references are removed by id when the AP mutation fails or settles", () => {
  const pending = addPendingApDbCanvasReferences(
    [],
    [
      {
        id: "intent-1",
        source: { kind: "AP", name: "api", namespace: "default" },
        target: { kind: "DB", name: "postgres", namespace: "default" },
      },
    ]
  );

  assert.deepEqual(
    removePendingApDbCanvasReferences(pending, ["intent-1"]),
    []
  );
});

test("resource-backed AP-DB connections make matching pending edges unnecessary", () => {
  assert.deepEqual(
    pendingApDbCanvasConnectionEdges({
      existingEdges: [
        {
          id: "detected:AP:default:api->DB:default:postgres",
          source: "ap-api",
          target: "db-postgres",
        },
      ],
      nodes: [apNode, dbNode],
      pendingReferences: [
        {
          id: "intent-1",
          source: { kind: "AP", name: "api", namespace: "default" },
          target: { kind: "DB", name: "postgres", namespace: "default" },
        },
      ],
    }),
    []
  );
});

test("multiple pending AP-DB references for the same pair render one edge", () => {
  assert.deepEqual(
    pendingApDbCanvasConnectionEdges({
      nodes: [apNode, dbNode],
      pendingReferences: [
        {
          id: "intent-1",
          source: { kind: "AP", name: "api", namespace: "default" },
          target: { kind: "DB", name: "postgres", namespace: "default" },
        },
        {
          id: "intent-2",
          source: { kind: "AP", name: "api", namespace: "default" },
          target: { kind: "DB", name: "postgres", namespace: "default" },
        },
      ],
    }),
    [
      {
        data: { pending: true },
        id: "pending:AP:default:api->DB:default:postgres",
        source: "ap-api",
        target: "db-postgres",
      },
    ]
  );
});
