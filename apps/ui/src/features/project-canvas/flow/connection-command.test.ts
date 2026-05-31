import assert from "node:assert/strict";
import { test } from "node:test";

import type { Connection, Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import {
  classifyProjectCanvasConnectionCommand,
  isProjectCanvasConnectionSupported,
} from "./connection-command";

const apNode = {
  data: {
    states: {
      kind: "AP",
      name: "api",
      namespace: "default",
      uid: "ap-uid",
    },
  },
  id: "ap-api",
  position: { x: 0, y: 0 },
  type: CANVAS_CONTAINER_NODE_TYPE,
} satisfies Node;

const dbNode = {
  data: {
    workload: {
      name: "postgres",
      namespace: "default",
    },
  },
  id: "db-postgres",
  position: { x: 320, y: 0 },
  type: CANVAS_DATABASE_NODE_TYPE,
} satisfies Node;

const entryNode = {
  data: {
    resource: {
      name: "api-entry",
      namespace: "default",
    },
  },
  id: "entry-api",
  position: { x: 640, y: 0 },
  type: CANVAS_ENTRY_NODE_TYPE,
} satisfies Node;

test("AP-to-DB Connecting Edge opens the AP Add Reference command", () => {
  const connection = {
    source: apNode.id,
    sourceHandle: "right",
    target: dbNode.id,
    targetHandle: "left",
  } satisfies Connection;

  assert.deepEqual(
    classifyProjectCanvasConnectionCommand({
      connection,
      nodes: [apNode, dbNode],
      readOnly: false,
    }),
    {
      ap: {
        name: "api",
        namespace: "default",
        nodeId: "ap-api",
        uid: "ap-uid",
      },
      db: {
        name: "postgres",
        namespace: "default",
        nodeId: "db-postgres",
      },
      kind: "openApDbAddReference",
    }
  );
});

test("DB-to-AP Connecting Edge opens the same AP Add Reference command", () => {
  const connection = {
    source: dbNode.id,
    sourceHandle: "left",
    target: apNode.id,
    targetHandle: "right",
  } satisfies Connection;

  assert.deepEqual(
    classifyProjectCanvasConnectionCommand({
      connection,
      nodes: [apNode, dbNode],
      readOnly: false,
    }),
    {
      ap: {
        name: "api",
        namespace: "default",
        nodeId: "ap-api",
        uid: "ap-uid",
      },
      db: {
        name: "postgres",
        namespace: "default",
        nodeId: "db-postgres",
      },
      kind: "openApDbAddReference",
    }
  );
});

test("AP-to-DB Connecting Edge opens Add Reference even when a Canvas Connection already exists", () => {
  const connection = {
    source: apNode.id,
    sourceHandle: "right",
    target: dbNode.id,
    targetHandle: "left",
  } satisfies Connection;

  assert.equal(
    classifyProjectCanvasConnectionCommand({
      connection,
      existingEdges: [
        { id: "detected:ap-db", source: apNode.id, target: dbNode.id },
      ],
      nodes: [apNode, dbNode],
      readOnly: false,
    }).kind,
    "openApDbAddReference"
  );
});

test("unsupported Connecting Edges are discarded", () => {
  const connection = {
    source: entryNode.id,
    sourceHandle: "right",
    target: dbNode.id,
    targetHandle: "left",
  } satisfies Connection;

  assert.deepEqual(
    classifyProjectCanvasConnectionCommand({
      connection,
      nodes: [entryNode, dbNode],
      readOnly: false,
    }),
    { kind: "discard", reason: "unsupported" }
  );
  assert.equal(
    isProjectCanvasConnectionSupported({
      connection,
      nodes: [entryNode, dbNode],
      readOnly: false,
    }),
    false
  );
});

test("read-only canvases discard AP-to-DB Connecting Edge commands", () => {
  const connection = {
    source: apNode.id,
    sourceHandle: "right",
    target: dbNode.id,
    targetHandle: "left",
  } satisfies Connection;

  assert.deepEqual(
    classifyProjectCanvasConnectionCommand({
      connection,
      nodes: [apNode, dbNode],
      readOnly: true,
    }),
    { kind: "discard", reason: "readOnly" }
  );
  assert.equal(
    isProjectCanvasConnectionSupported({
      connection,
      nodes: [apNode, dbNode],
      readOnly: true,
    }),
    false
  );
});

test("supported AP-to-DB Connecting Edges are valid for React Flow", () => {
  assert.equal(
    isProjectCanvasConnectionSupported({
      connection: {
        source: apNode.id,
        sourceHandle: "right",
        target: dbNode.id,
        targetHandle: "left",
      },
      nodes: [apNode, dbNode],
      readOnly: false,
    }),
    true
  );
});
