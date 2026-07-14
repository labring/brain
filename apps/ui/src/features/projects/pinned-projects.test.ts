import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addPinnedProjectId,
  MAX_PINNED_PROJECTS,
  normalizePinnedProjectIds,
  pinnedProjectIdsEqual,
  prunePinnedProjectIds,
  togglePinnedProjectId,
} from "./pinned-projects";

test("pinned project IDs normalize strings, remove duplicates, and respect the limit", () => {
  assert.deepEqual(
    normalizePinnedProjectIds([
      " project-a ",
      "project-b",
      "project-a",
      "",
      123,
      "project-c",
    ]),
    ["project-a", "project-b", "project-c"]
  );

  assert.equal(
    normalizePinnedProjectIds(
      Array.from({ length: MAX_PINNED_PROJECTS + 2 }, (_, index) =>
        String(index)
      )
    ).length,
    MAX_PINNED_PROJECTS
  );
});

test("adding a pinned project appends until the pinned-project limit", () => {
  assert.deepEqual(addPinnedProjectId(["project-a"], "project-b"), {
    ids: ["project-a", "project-b"],
    status: "added",
  });

  assert.equal(
    addPinnedProjectId(
      Array.from(
        { length: MAX_PINNED_PROJECTS },
        (_, index) => `project-${index}`
      ),
      "project-overflow"
    ).status,
    "limit-reached"
  );
});

test("toggling a pinned project removes existing IDs and adds new IDs", () => {
  assert.deepEqual(togglePinnedProjectId(["project-a"], "project-a"), {
    ids: [],
    status: "removed",
  });

  assert.deepEqual(togglePinnedProjectId(["project-a"], "project-b"), {
    ids: ["project-a", "project-b"],
    status: "added",
  });
});

test("pruning pinned project IDs removes deleted projects while preserving order", () => {
  assert.deepEqual(
    prunePinnedProjectIds(
      ["project-a", "project-b", "project-c"],
      new Set(["project-c", "project-a"])
    ),
    ["project-a", "project-c"]
  );
});

test("pinned project ID equality preserves shortcut order", () => {
  assert.equal(pinnedProjectIdsEqual(["project-a"], ["project-a"]), true);
  assert.equal(
    pinnedProjectIdsEqual(
      ["project-a", "project-b"],
      ["project-b", "project-a"]
    ),
    false
  );
});
