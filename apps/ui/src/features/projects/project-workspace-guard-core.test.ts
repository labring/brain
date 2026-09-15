import assert from "node:assert/strict";
import { test } from "node:test";

import { projectWorkspaceGuardDecision } from "./project-workspace-guard-core";

test("a loaded list that lacks the Project sends the page to the Project list", () => {
  assert.equal(
    projectWorkspaceGuardDecision({
      loaded: true,
      projectId: "elsewhere",
      projectIds: ["alpha", "beta"],
    }),
    "leave"
  );
});

test("a loaded list that has the Project keeps the page", () => {
  assert.equal(
    projectWorkspaceGuardDecision({
      loaded: true,
      projectId: "beta",
      projectIds: ["alpha", "beta"],
    }),
    "stay"
  );
});

test("nothing is judged while the list is loading or off a Project route", () => {
  assert.equal(
    projectWorkspaceGuardDecision({
      loaded: false,
      projectId: "elsewhere",
      projectIds: [],
    }),
    "stay"
  );
  assert.equal(
    projectWorkspaceGuardDecision({
      loaded: true,
      projectId: "",
      projectIds: ["alpha"],
    }),
    "stay"
  );
});
