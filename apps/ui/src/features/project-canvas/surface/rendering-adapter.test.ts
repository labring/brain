import assert from "node:assert/strict";
import { test } from "node:test";

import type { Node } from "@xyflow/react";
import type { ProjectSurfaceState } from "@/features/panes/surface-state";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import type { ProjectRuntimeNodeModels } from "@/features/project-runtime/resource-models";
import {
  createProjectCanvasDrawerRenderModel,
  createProjectCanvasMainRenderModel,
  createProjectCanvasSideRenderModel,
  createProjectCanvasSurfaceRenderModel,
} from "./rendering-adapter";

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

const runtimeApShellNode = {
  data: {
    runtime: {
      kind: "AP",
      modelKey: "AP:default:api",
      resourceRef: { kind: "AP", name: "api", namespace: "default" },
    },
  },
  id: "ap-api",
  position: { x: 0, y: 0 },
  type: CANVAS_CONTAINER_NODE_TYPE,
} as Node;

const runtimeDbShellNode = {
  data: {
    runtime: {
      kind: "DB",
      modelKey: "DB:data:pg",
      resourceRef: { kind: "DB", name: "pg", namespace: "data" },
    },
  },
  id: "db-pg",
  position: { x: 0, y: 0 },
  type: CANVAS_DATABASE_NODE_TYPE,
} as Node;

const runtimeNodeModels: ProjectRuntimeNodeModels = {
  containerModelsByKey: new Map([
    [
      "AP:default:api",
      {
        resourceKind: "ap",
        states: {
          image: "nginx:1.27",
          kind: "AP",
          name: "api",
          namespace: "default",
          status: { label: "Running", tone: "running" },
          uid: "ap-uid",
        },
      },
    ],
  ]),
  databaseModelsByKey: new Map([
    [
      "DB:data:pg",
      {
        connections: [],
        states: {
          displayEngine: "PostgreSQL",
          formattedVersion: "16.4",
          name: "pg",
        },
        uid: "db-uid",
        workload: { name: "pg", namespace: "data" },
      },
    ],
  ]),
  entryModelsByKey: new Map(),
};

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
        kind: "settings",
        target: { kind: "AP", name: "api", namespace: "default" },
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected resource side render model");
  }
  assert.equal(model.side.content.kind, "settings");
  assert.equal(model.side.content.node, apNode);
  assert.deepEqual(model.side.content.target, {
    kind: "settings",
    target: { kind: "AP", name: "api", namespace: "default" },
  });
});

test("canvas surface adapter resolves AP Environment Settings focus", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [apNode],
    surfaceState: {
      ...emptyState,
      side: {
        kind: "settings",
        target: { kind: "AP", name: "api", namespace: "default" },
        view: "environment",
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected resource side render model");
  }
  assert.equal(model.side.content.kind, "settings");
  assert.equal(model.side.content.node, apNode);
  assert.equal(model.side.content.target.view, "environment");
});

test("canvas surface adapter renders AP shell panes with runtime model data", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [runtimeApShellNode],
    runtimeNodeModels,
    surfaceState: {
      ...emptyState,
      side: {
        kind: "apMetrics",
        target: { kind: "AP", name: "api", namespace: "default" },
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected resource side render model");
  }
  assert.equal(model.side.content.kind, "apMetrics");
  assert.notEqual(model.side.content.node, runtimeApShellNode);
  const renderData = model.side.content.node.data as {
    runtime?: { modelKey?: string };
    states?: { name?: string; namespace?: string };
  };
  const shellData = runtimeApShellNode.data as { states?: unknown };
  assert.equal(renderData.runtime?.modelKey, "AP:default:api");
  assert.equal(renderData.states?.name, "api");
  assert.equal(renderData.states?.namespace, "default");
  assert.equal(shellData.states, undefined);
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

test("canvas surface adapter renders DB shell surfaces with runtime model data", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [runtimeDbShellNode],
    runtimeNodeModels,
    surfaceState: {
      drawer: {
        kind: "dbTerminal",
        target: { kind: "DB", name: "pg", namespace: "data" },
      },
      main: {
        focusPolicy: "keepSideVisible",
        kind: "resourceLogs",
        target: { kind: "DB", name: "pg", namespace: "data" },
      },
      side: {
        kind: "dbMetrics",
        target: { kind: "DB", name: "pg", namespace: "data" },
      },
    },
  });
  const dbAccess = createProjectCanvasMainRenderModel({
    entry: {
      kind: "dbAccess",
      target: { kind: "DB", name: "pg", namespace: "data" },
    },
    nodes: [runtimeDbShellNode],
    runtimeNodeModels,
  });

  if (model.drawer?.kind !== "dbTerminal") {
    assert.fail("expected DB terminal drawer render model");
  }
  if (model.main?.kind !== "dbLogs") {
    assert.fail("expected DB logs main render model");
  }
  if (model.side?.kind !== "resource") {
    assert.fail("expected DB metrics side render model");
  }
  if (dbAccess?.kind !== "dbAccess") {
    assert.fail("expected DB access main render model");
  }
  assert.equal(model.side.content.kind, "dbMetrics");

  const drawerData = model.drawer.node.data as {
    runtime?: { modelKey?: string };
    states?: { displayEngine?: string };
    workload?: { name?: string; namespace?: string };
  };
  const logsData = model.main.node.data as {
    states?: { displayEngine?: string };
    workload?: { name?: string; namespace?: string };
  };
  const metricsData = model.side.content.node.data as {
    states?: { displayEngine?: string };
    workload?: { name?: string; namespace?: string };
  };
  const dbAccessData = dbAccess.node.data as {
    states?: { displayEngine?: string };
    workload?: { name?: string; namespace?: string };
  };
  const shellData = runtimeDbShellNode.data as { states?: unknown };

  assert.equal(drawerData.runtime?.modelKey, "DB:data:pg");
  assert.equal(drawerData.states?.displayEngine, "PostgreSQL");
  assert.deepEqual(drawerData.workload, { name: "pg", namespace: "data" });
  assert.equal(logsData.states?.displayEngine, "PostgreSQL");
  assert.deepEqual(logsData.workload, { name: "pg", namespace: "data" });
  assert.equal(metricsData.states?.displayEngine, "PostgreSQL");
  assert.deepEqual(metricsData.workload, { name: "pg", namespace: "data" });
  assert.equal(dbAccessData.states?.displayEngine, "PostgreSQL");
  assert.deepEqual(dbAccessData.workload, { name: "pg", namespace: "data" });
  assert.equal(dbAccess.databaseData.states.displayEngine, "PostgreSQL");
  assert.equal(shellData.states, undefined);
});

test("canvas surface adapter exposes independent slot renderers", () => {
  const side = createProjectCanvasSideRenderModel({
    nodes: [apNode],
    surfaceState: {
      main: null,
      side: {
        kind: "settings",
        target: { kind: "AP", name: "api", namespace: "default" },
      },
    },
  });
  const main = createProjectCanvasMainRenderModel({
    entry: {
      kind: "dbAccess",
      target: { kind: "DB", name: "pg", namespace: "data" },
    },
    nodes: [dbNode],
  });
  const drawer = createProjectCanvasDrawerRenderModel({
    entry: {
      kind: "dbTerminal",
      target: { kind: "DB", name: "pg", namespace: "data" },
    },
    nodes: [dbNode],
  });

  if (side?.kind !== "resource") {
    assert.fail("expected resource side render model");
  }
  assert.equal(side.content.kind, "settings");
  assert.equal(main?.kind, "dbAccess");
  assert.equal(drawer?.kind, "dbTerminal");
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
        kind: "settings",
        target: { kind: "AP", name: "api", namespace: "default" },
        view: "public-addresses",
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected resource side render model");
  }
  assert.equal(model.side.content.kind, "settings");
  assert.equal(model.side.content.target.view, "public-addresses");
  assert.equal(model.side.content.entryNode, null);
});

test("canvas surface adapter attaches the PublicAccess node when it exists", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [apNode, entryNode],
    surfaceState: {
      ...emptyState,
      side: {
        kind: "settings",
        target: { kind: "AP", name: "api", namespace: "default" },
        view: "public-addresses",
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected resource side render model");
  }
  assert.equal(model.side.content.kind, "settings");
  assert.equal(model.side.content.entryNode, entryNode);
});

test("canvas surface adapter lets settings providers resolve missing canvas targets", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [],
    surfaceState: {
      ...emptyState,
      side: {
        kind: "settings",
        target: { kind: "AP", name: "api", namespace: "default" },
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected settings side render model");
  }
  assert.equal(model.side.content.kind, "settings");
  assert.equal(model.side.content.node, null);
  assert.deepEqual(model.side.content.target.target, {
    kind: "AP",
    name: "api",
    namespace: "default",
  });
});

test("canvas surface adapter opens DB settings without canvas database data", () => {
  const model = createProjectCanvasSurfaceRenderModel({
    nodes: [],
    surfaceState: {
      ...emptyState,
      side: {
        kind: "settings",
        target: { kind: "DB", name: "pg", namespace: "data" },
      },
    },
  });

  if (model.side?.kind !== "resource") {
    assert.fail("expected settings side render model");
  }
  assert.equal(model.side.content.kind, "settings");
  assert.equal(model.side.content.databaseData, undefined);
  assert.equal(model.side.content.node, null);
  assert.deepEqual(model.side.content.target.target, {
    kind: "DB",
    name: "pg",
    namespace: "data",
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
        kind: "settings",
        target: { kind: "AP", name: "api", namespace: "default" },
      },
    },
  });

  assert.equal(model.side, null);
  assert.equal(model.main?.kind, "dbAccess");
});
