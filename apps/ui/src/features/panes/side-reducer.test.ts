import assert from "node:assert/strict";
import { test } from "node:test";

import {
  planCloseProjectSideRouteState,
  planOpenProjectSideRouteState,
  repairUnsupportedProjectSideRouteState,
} from "./side-reducer";
import type { ProjectSideRouteState } from "./side-state";

const state = {
  side: { entryMode: "general", kind: "projectCreation" },
} satisfies ProjectSideRouteState;

test("opening a side route entry plans a switch leave when side is active", () => {
  const result = planOpenProjectSideRouteState(state, {
    entryMode: "githubDirect",
    kind: "projectCreation",
  });

  assert.deepEqual(result.next.side, {
    entryMode: "githubDirect",
    kind: "projectCreation",
  });
  assert.deepEqual(result.requiredLeave, {
    action: "switch",
    surface: "side",
  });
});

test("closing a side route entry plans a close leave when side is active", () => {
  const result = planCloseProjectSideRouteState(state);

  assert.equal(result.next.side, null);
  assert.deepEqual(result.requiredLeave, {
    action: "close",
    surface: "side",
  });
});

test("unsupported side route entries are repaired without leave guard", () => {
  const result = repairUnsupportedProjectSideRouteState(
    state,
    (entry) => entry.kind !== "projectCreation"
  );

  assert.equal(result.next.side, null);
  assert.equal(result.requiredLeave, null);
});
