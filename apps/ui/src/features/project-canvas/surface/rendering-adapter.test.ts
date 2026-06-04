import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import type { ProjectSurfaceState } from "@/features/project-surfaces/surface-state";
import { createProjectCanvasSurfaceRenderModel } from "./rendering-adapter";

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
} as Node;

const dbNode = {
  data: {
    connections: [],
    states: {
      displayEngine: "PostgreSQL",
      formattedVersion: "16.4",
      name: "pg",
    },
    uid: "db-uid",
    workload: { name: "pg", namespace: "data" },
  },
  id: "db-pg",
  position: { x: 0, y: 0 },
  type: CANVAS_DATABASE_NODE_TYPE,
} as Node;

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
  position: { x: 0, y: 0 },
  type: CANVAS_ENTRY_NODE_TYPE,
} as Node;

const emptyState: ProjectSurfaceState = {
  drawer: null,
  main: null,
  side: null,
};

test("canvas surface adapter resolves AP side panes from surface targets", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [apNode],
    surfaceState: {
      ...emptyState,
      side: {
        kind: "apSettings",
        target: { kind: "AP", name: "api", namespace: "default" },
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected resource side render model");
  }
  assert.equal(model.side.content.kind, "apSettings");
  assert.equal(model.side.content.node, apNode);
});

test("canvas surface adapter resolves DB access and DB terminal independently", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [dbNode],
    surfaceState: {
      drawer: {
        kind: "dbTerminal",
        target: { kind: "DB", name: "pg", namespace: "data" },
      },
      main: {
        kind: "dbAccess",
        target: { kind: "DB", name: "pg", namespace: "data" },
      },
      side: null,
    },
  });

  if (model.main?.kind !== "dbAccess") {
    assert.fail("expected DB access main render model");
  }
  if (model.drawer?.kind !== "dbTerminal") {
    assert.fail("expected DB terminal drawer render model");
  }
  assert.equal(model.main.node, dbNode);
  assert.equal(model.main.databaseData.workload.name, "pg");
  assert.equal(model.drawer.node, dbNode);
});

test("canvas surface adapter resolves resource logs by target kind", () => {
  const apLogs = createProjectCanvasSurfaceRenderModel({
    nodes: [apNode],
    surfaceState: {
      ...emptyState,
      main: {
        kind: "resourceLogs",
        target: { kind: "AP", name: "api", namespace: "default" },
      },
    },
  });
  const dbLogs = createProjectCanvasSurfaceRenderModel({
    nodes: [dbNode],
    surfaceState: {
      ...emptyState,
      main: {
        kind: "resourceLogs",
        target: { kind: "DB", name: "pg", namespace: "data" },
      },
    },
  });

  if (apLogs.main?.kind !== "apLogs") {
    assert.fail("expected AP logs main render model");
  }
  if (dbLogs.main?.kind !== "dbLogs") {
    assert.fail("expected DB logs main render model");
  }
  assert.equal(apLogs.main.node, apNode);
  assert.equal(dbLogs.main.node, dbNode);
});

test("canvas surface adapter keeps AP-bound Public Addresses resolved through the AP", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [apNode],
    surfaceState: {
      ...emptyState,
      side: {
        kind: "publicAddresses",
        target: { apName: "api", kind: "EntryPoint", namespace: "default" },
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected resource side render model");
  }
  assert.equal(model.side.content.kind, "publicAddresses");
  assert.deepEqual(model.side.content.selection, {
    apName: "api",
    namespace: "default",
  });
  assert.equal(model.side.content.entryNode, null);
});

test("canvas surface adapter attaches the EntryPoint node when it exists", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [apNode, entryNode],
    surfaceState: {
      ...emptyState,
      side: {
        kind: "publicAddresses",
        target: { apName: "api", kind: "EntryPoint", namespace: "default" },
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected resource side render model");
  }
  assert.equal(model.side.content.kind, "publicAddresses");
  assert.equal(model.side.content.entryNode, entryNode);
});

test("canvas surface adapter represents unresolved targets explicitly", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [],
    surfaceState: {
      ...emptyState,
      side: {
        kind: "apSettings",
        target: { kind: "AP", name: "api", namespace: "default" },
      },
    },
  });

  if (model.side?.kind !== "pendingTarget") {
    assert.fail("expected pending target side render model");
  }
  assert.deepEqual(model.side.target, {
    kind: "AP",
    name: "api",
    namespace: "default",
  });
});

test("canvas surface adapter preserves global side entries including Project creation", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [],
    surfaceState: {
      ...emptyState,
      side: { entryMode: "githubDirect", kind: "projectCreation" },
    },
  });

  if (model.side?.kind !== "global") {
    assert.fail("expected global side render model");
  }
  assert.deepEqual(model.side.entry, {
    entryMode: "githubDirect",
    kind: "projectCreation",
  });
});

test("canvas surface adapter hides side entries behind focused main surfaces", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [apNode, dbNode],
    surfaceState: {
      drawer: null,
      main: {
        kind: "dbAccess",
        target: { kind: "DB", name: "pg", namespace: "data" },
      },
      side: {
        kind: "apSettings",
        target: { kind: "AP", name: "api", namespace: "default" },
      },
    },
  });

  assert.equal(model.side, null);
  assert.equal(model.main?.kind, "dbAccess");
});
