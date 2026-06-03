import assert from "node:assert/strict";
import { test } from "node:test";

import type { Connection, Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import { planProjectCanvasCommand } from "./command-model";

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
    connections: [],
    states: { name: "postgres" },
    uid: "db-uid",
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
      apRef: "api",
      name: "api-entry",
      namespace: "default",
      uid: "entry-uid",
    },
  },
  id: "entry-api",
  position: { x: 640, y: 0 },
  type: CANVAS_ENTRY_NODE_TYPE,
} satisfies Node;

test("node click plans selection, default Side Pane, and stack order", () => {
  assert.deepEqual(
    planProjectCanvasCommand({
      intent: { kind: "nodeClick", node: apNode },
      nodes: [apNode],
      readOnly: false,
    }),
    {
      selection: {
        kind: "resource",
        target: {
          kind: "AP",
          name: "api",
          namespace: "default",
          observedUid: "ap-uid",
        },
      },
      stackOrder: { kind: "bringNodeToFront", nodeId: "ap-api" },
      surface: {
        entry: {
          kind: "apSettings",
          target: {
            kind: "AP",
            name: "api",
            namespace: "default",
            observedUid: "ap-uid",
          },
        },
        slot: "side",
      },
    }
  );
});

test("EntryPoint node click opens AP-bound Public Addresses", () => {
  assert.deepEqual(
    planProjectCanvasCommand({
      intent: { kind: "nodeClick", node: entryNode },
      nodes: [entryNode],
      readOnly: false,
    }),
    {
      selection: {
        kind: "publicAddresses",
        target: {
          apName: "api",
          kind: "EntryPoint",
          namespace: "default",
          observedUid: "entry-uid",
        },
      },
      stackOrder: { kind: "bringNodeToFront", nodeId: "entry-api" },
      surface: {
        entry: {
          kind: "publicAddresses",
          target: {
            apName: "api",
            kind: "EntryPoint",
            namespace: "default",
            observedUid: "entry-uid",
          },
        },
        slot: "side",
      },
    }
  );
});

test("AP quick actions plan the matching project surface slot", () => {
  assert.deepEqual(
    planProjectCanvasCommand({
      intent: {
        action: "terminal",
        kind: "containerQuickAction",
        node: apNode,
      },
      nodes: [apNode],
      readOnly: false,
    }).surface,
    {
      entry: {
        kind: "apTerminal",
        target: {
          kind: "AP",
          name: "api",
          namespace: "default",
          observedUid: "ap-uid",
        },
      },
      slot: "drawer",
    }
  );

  assert.deepEqual(
    planProjectCanvasCommand({
      intent: { action: "logs", kind: "containerQuickAction", node: apNode },
      nodes: [apNode],
      readOnly: false,
    }).surface,
    {
      entry: {
        kind: "resourceLogs",
        target: {
          kind: "AP",
          name: "api",
          namespace: "default",
          observedUid: "ap-uid",
        },
      },
      slot: "main",
    }
  );
});

test("DB quick actions plan DB Access, logs, terminal, and metrics surfaces", () => {
  assert.deepEqual(
    planProjectCanvasCommand({
      intent: { action: "dbAccess", kind: "databaseQuickAction", node: dbNode },
      nodes: [dbNode],
      readOnly: false,
    }).surface,
    {
      entry: {
        kind: "dbAccess",
        target: {
          kind: "DB",
          name: "postgres",
          namespace: "default",
          observedUid: "db-uid",
        },
      },
      slot: "main",
    }
  );

  assert.deepEqual(
    planProjectCanvasCommand({
      intent: { action: "metrics", kind: "databaseQuickAction", node: dbNode },
      nodes: [dbNode],
      readOnly: false,
    }).surface,
    {
      entry: {
        kind: "dbMetrics",
        target: {
          kind: "DB",
          name: "postgres",
          namespace: "default",
          observedUid: "db-uid",
        },
      },
      slot: "side",
    }
  );
});

test("AP-to-DB Connecting Edge plans AP Settings with pending Database Binding intent", () => {
  const connection = {
    source: apNode.id,
    sourceHandle: "right",
    target: dbNode.id,
    targetHandle: "left",
  } satisfies Connection;

  assert.deepEqual(
    planProjectCanvasCommand({
      intent: { connection, kind: "connectingEdge" },
      nodes: [apNode, dbNode],
      readOnly: false,
    }),
    {
      guard: { action: "switch", kind: "settingsLeave" },
      pendingDbReference: {
        apNodeId: "ap-api",
        dbName: "postgres",
        dbNamespace: "default",
      },
      selection: {
        kind: "resource",
        target: {
          kind: "AP",
          name: "api",
          namespace: "default",
          observedUid: "ap-uid",
        },
      },
      surface: {
        entry: {
          kind: "apSettings",
          target: {
            kind: "AP",
            name: "api",
            namespace: "default",
            observedUid: "ap-uid",
          },
        },
        slot: "side",
      },
    }
  );
});

test("unsupported Connecting Edge plans feedback without a surface", () => {
  assert.deepEqual(
    planProjectCanvasCommand({
      intent: {
        connection: {
          source: entryNode.id,
          sourceHandle: "right",
          target: dbNode.id,
          targetHandle: "left",
        },
        kind: "connectingEdge",
      },
      nodes: [entryNode, dbNode],
      readOnly: false,
    }),
    {
      feedback: {
        message: "That canvas connection is not supported yet.",
        tone: "info",
      },
    }
  );
});

test("read-only Connecting Edge discards without feedback", () => {
  assert.deepEqual(
    planProjectCanvasCommand({
      intent: {
        connection: {
          source: apNode.id,
          sourceHandle: "right",
          target: dbNode.id,
          targetHandle: "left",
        },
        kind: "connectingEdge",
      },
      nodes: [apNode, dbNode],
      readOnly: true,
    }),
    {}
  );
});
