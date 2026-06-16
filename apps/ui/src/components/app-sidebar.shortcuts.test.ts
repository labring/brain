import assert from "node:assert/strict";
import { test } from "node:test";

import { createProjectSidebarShortcutItems } from "./app-sidebar.shortcuts";

const projects = [
  {
    createdAt: "2026-05-26T00:00:00.000Z",
    id: "project-a",
    name: "Project A",
  },
  {
    createdAt: "2026-05-26T00:00:00.000Z",
    id: "project-b",
    name: "Project B",
  },
  {
    createdAt: "2026-05-26T00:00:00.000Z",
    id: "project-c",
    name: "Project C",
  },
];

function itemKeys(
  input: ReturnType<typeof createProjectSidebarShortcutItems>
): string[] {
  return input.map((item) => `${item.kind}:${item.project.id}`);
}

test("sidebar shortcuts show the last viewed unpinned project before pinned projects", () => {
  assert.deepEqual(
    itemKeys(
      createProjectSidebarShortcutItems({
        lastViewedProjectId: "project-c",
        pinnedProjectIds: ["project-a", "project-b"],
        projects,
      })
    ),
    ["lastViewed:project-c", "pinned:project-a", "pinned:project-b"]
  );
});

test("sidebar shortcuts omit the last viewed project when it is pinned", () => {
  assert.deepEqual(
    itemKeys(
      createProjectSidebarShortcutItems({
        lastViewedProjectId: "project-b",
        pinnedProjectIds: ["project-a", "project-b", "project-c"],
        projects,
      })
    ),
    ["pinned:project-a", "pinned:project-b", "pinned:project-c"]
  );
});

test("sidebar shortcuts omit stale pinned projects and duplicate IDs", () => {
  assert.deepEqual(
    itemKeys(
      createProjectSidebarShortcutItems({
        lastViewedProjectId: undefined,
        pinnedProjectIds: ["project-missing", "project-a", "project-a"],
        projects,
      })
    ),
    ["pinned:project-a"]
  );
});

test("sidebar shortcuts omit a stale last viewed project", () => {
  assert.deepEqual(
    itemKeys(
      createProjectSidebarShortcutItems({
        lastViewedProjectId: "project-missing",
        pinnedProjectIds: ["project-a"],
        projects,
      })
    ),
    ["pinned:project-a"]
  );
});
