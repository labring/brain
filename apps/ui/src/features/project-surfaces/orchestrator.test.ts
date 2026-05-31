import assert from "node:assert/strict";
import { test } from "node:test";

import {
  closeProjectSurfaceSlot,
  createProjectSurfaceState,
  openProjectSurface,
  setProjectCanvasSelection,
} from "./orchestrator";
import { projectSideSurfaceVisible } from "./surface-state";
import type { ProjectApTarget, ProjectDbTarget } from "./target-identity";

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

test("project surface slots are single-active within each slot", () => {
  const state = createProjectSurfaceState({
    side: { kind: "apSettings", target: ap },
  });

  const next = openProjectSurface(state, {
    entry: { kind: "dbSettings", target: db },
    select: { kind: "resource", target: db },
    slot: "side",
  });

  assert.deepEqual(next.side, { kind: "dbSettings", target: db });
  assert.deepEqual(next.selected, { kind: "resource", target: db });
});

test("session drawer coexists with side and main surfaces and stays pinned across selection changes", () => {
  const withDrawer = openProjectSurface(createProjectSurfaceState(), {
    entry: { kind: "apTerminal", target: ap },
    select: { kind: "resource", target: ap },
    slot: "drawer",
  });
  const withSide = openProjectSurface(withDrawer, {
    entry: { kind: "dbSettings", target: db },
    select: { kind: "resource", target: db },
    slot: "side",
  });
  const selectedElsewhere = setProjectCanvasSelection(withSide, {
    kind: "resource",
    target: db,
  });

  assert.deepEqual(selectedElsewhere.drawer, {
    kind: "apTerminal",
    target: ap,
  });
  assert.deepEqual(selectedElsewhere.side, { kind: "dbSettings", target: db });
});

test("opening a second drawer entry replaces the first drawer entry only", () => {
  const state = createProjectSurfaceState({
    drawer: { kind: "apTerminal", target: ap },
    side: { kind: "apSettings", target: ap },
  });

  const next = openProjectSurface(state, {
    entry: { kind: "dbConsole", target: db },
    slot: "drawer",
  });

  assert.deepEqual(next.drawer, { kind: "dbConsole", target: db });
  assert.deepEqual(next.side, state.side);
});

test("main action surface defaults to focusing main-area work over side", () => {
  const state = openProjectSurface(
    createProjectSurfaceState({
      side: { kind: "dbSettings", target: db },
    }),
    {
      entry: { kind: "dbAccess", target: db },
      slot: "main",
    }
  );

  assert.equal(projectSideSurfaceVisible(state), false);
  assert.deepEqual(state.side, { kind: "dbSettings", target: db });
});

test("main action surface can explicitly keep inspection visible", () => {
  const state = openProjectSurface(
    createProjectSurfaceState({
      side: { kind: "dbSettings", target: db },
    }),
    {
      entry: {
        focusPolicy: "keepSideVisible",
        kind: "resourceLogs",
        target: db,
      },
      slot: "main",
    }
  );

  assert.equal(projectSideSurfaceVisible(state), true);
});

test("closing one surface slot does not disturb selection or other slots", () => {
  const state = createProjectSurfaceState({
    drawer: { kind: "dbConsole", target: db },
    main: { kind: "dbAccess", target: db },
    selected: { kind: "resource", target: db },
    side: { kind: "dbSettings", target: db },
  });

  const next = closeProjectSurfaceSlot(state, "main");

  assert.equal(next.main, null);
  assert.deepEqual(next.drawer, state.drawer);
  assert.deepEqual(next.side, state.side);
  assert.deepEqual(next.selected, state.selected);
});
