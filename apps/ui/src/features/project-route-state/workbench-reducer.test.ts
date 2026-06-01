import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  ProjectApTarget,
  ProjectDbTarget,
} from "@/features/project-surfaces/target-identity";
import {
  planClearProjectWorkbenchCanvasFocus,
  planFocusProjectWorkbenchCanvasSelection,
  planOpenProjectWorkbenchSurface,
  repairStaleProjectWorkbenchRouteState,
} from "./workbench-reducer";
import type { ProjectWorkbenchRouteState } from "./workbench-state";

const ap: ProjectApTarget = {
  kind: "AP",
  name: "api",
  namespace: "default",
};
const db: ProjectDbTarget = {
  kind: "DB",
  name: "pg",
  namespace: "default",
};

const emptyState: ProjectWorkbenchRouteState = {
  canvasSelection: null,
  surfaces: {
    drawer: null,
    main: null,
    side: null,
  },
};

test("opening side updates side and canvas selection while clearing main", () => {
  const state: ProjectWorkbenchRouteState = {
    canvasSelection: { kind: "resource", target: db },
    surfaces: {
      drawer: { kind: "dbConsole", target: db },
      main: { kind: "resourceLogs", target: db },
      side: null,
    },
  };

  const result = planOpenProjectWorkbenchSurface(state, {
    canvasSelection: { kind: "resource", target: ap },
    entry: { kind: "apSettings", target: ap },
    slot: "side",
  });

  assert.deepEqual(result.next, {
    canvasSelection: { kind: "resource", target: ap },
    surfaces: {
      drawer: { kind: "dbConsole", target: db },
      main: null,
      side: { kind: "apSettings", target: ap },
    },
  });
  assert.equal(result.requiredLeave, null);
});

test("opening focused main requires side leave only when visible side is hidden", () => {
  const state: ProjectWorkbenchRouteState = {
    ...emptyState,
    surfaces: {
      ...emptyState.surfaces,
      side: { kind: "dbSettings", target: db },
    },
  };

  const result = planOpenProjectWorkbenchSurface(state, {
    entry: { kind: "dbAccess", target: db },
    slot: "main",
  });

  assert.deepEqual(result.requiredLeave, {
    action: "hide",
    surface: "side",
  });

  const keepVisible = planOpenProjectWorkbenchSurface(state, {
    entry: {
      focusPolicy: "keepSideVisible",
      kind: "resourceLogs",
      target: db,
    },
    slot: "main",
  });

  assert.equal(keepVisible.requiredLeave, null);
});

test("clear canvas focus clears selection, side and main while keeping drawer", () => {
  const state: ProjectWorkbenchRouteState = {
    canvasSelection: { kind: "resource", target: db },
    surfaces: {
      drawer: { kind: "dbConsole", target: db },
      main: { kind: "dbAccess", target: db },
      side: { kind: "dbSettings", target: db },
    },
  };

  const result = planClearProjectWorkbenchCanvasFocus(state);

  assert.deepEqual(result.next, {
    canvasSelection: null,
    surfaces: {
      drawer: { kind: "dbConsole", target: db },
      main: null,
      side: null,
    },
  });
  assert.deepEqual(result.requiredLeave, {
    action: "close",
    surface: "side",
  });
});

test("focus canvas selection replaces side and main while keeping drawer", () => {
  const state: ProjectWorkbenchRouteState = {
    canvasSelection: { kind: "resource", target: db },
    surfaces: {
      drawer: { kind: "dbConsole", target: db },
      main: { kind: "dbAccess", target: db },
      side: { kind: "dbSettings", target: db },
    },
  };

  const result = planFocusProjectWorkbenchCanvasSelection(state, {
    edgeId: "edge-1",
    kind: "edge",
  });

  assert.deepEqual(result.next, {
    canvasSelection: { edgeId: "edge-1", kind: "edge" },
    surfaces: {
      drawer: { kind: "dbConsole", target: db },
      main: null,
      side: null,
    },
  });
  assert.deepEqual(result.requiredLeave, {
    action: "switch",
    surface: "side",
  });
});

test("stale cleanup clears invalid targets without leave guard", () => {
  const state: ProjectWorkbenchRouteState = {
    canvasSelection: { kind: "resource", target: db },
    surfaces: {
      drawer: { kind: "dbConsole", target: db },
      main: { kind: "resourceLogs", target: ap },
      side: { kind: "dbSettings", target: db },
    },
  };

  const result = repairStaleProjectWorkbenchRouteState(state, {
    canvasSelectionExists: (selection) =>
      selection.kind !== "resource" || selection.target.kind !== "DB",
    sideEntrySupported: () => true,
    targetExists: (target) => target.kind !== "DB",
  });

  assert.deepEqual(result.next, {
    canvasSelection: null,
    surfaces: {
      drawer: null,
      main: { kind: "resourceLogs", target: ap },
      side: null,
    },
  });
  assert.equal(result.requiredLeave, null);
});
