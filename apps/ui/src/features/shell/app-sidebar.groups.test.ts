import assert from "node:assert/strict";
import { test } from "node:test";

import { createAppSidebarProjectGroups } from "./app-sidebar.groups";

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
  {
    createdAt: "2026-05-26T00:00:00.000Z",
    id: "project-d",
    name: "Project D",
  },
];

function groupIds(input: ReturnType<typeof createAppSidebarProjectGroups>): {
  pinned: string[];
  projects: string[];
} {
  return {
    pinned: input.pinned.map((project) => project.id),
    projects: input.projects.map((project) => project.id),
  };
}

test("pinned projects stay in pin order and the rest keep list order", () => {
  assert.deepEqual(
    groupIds(
      createAppSidebarProjectGroups({
        pinnedProjectIds: ["project-c", "project-a"],
        projects,
      })
    ),
    {
      pinned: ["project-c", "project-a"],
      projects: ["project-b", "project-d"],
    }
  );
});

test("an empty pin list hides the pinned group and lists every project", () => {
  assert.deepEqual(
    groupIds(
      createAppSidebarProjectGroups({
        pinnedProjectIds: [],
        projects,
      })
    ),
    {
      pinned: [],
      projects: ["project-a", "project-b", "project-c", "project-d"],
    }
  );
});

test("stale, empty, and duplicate pin ids are dropped", () => {
  assert.deepEqual(
    groupIds(
      createAppSidebarProjectGroups({
        pinnedProjectIds: ["", "project-missing", "project-a", "project-a"],
        projects,
      })
    ),
    {
      pinned: ["project-a"],
      projects: ["project-b", "project-c", "project-d"],
    }
  );
});

test("pinned group keeps at most eight projects", () => {
  const many = Array.from({ length: 10 }, (_, index) => ({
    createdAt: "2026-05-26T00:00:00.000Z",
    id: `project-${index}`,
    name: `Project ${index}`,
  }));
  const grouped = createAppSidebarProjectGroups({
    pinnedProjectIds: many.map((project) => project.id),
    projects: many,
  });

  assert.deepEqual(
    grouped.pinned.map((project) => project.id),
    many.slice(0, 8).map((project) => project.id)
  );
  assert.deepEqual(
    grouped.projects.map((project) => project.id),
    ["project-8", "project-9"]
  );
});

test("an empty project list yields two empty groups", () => {
  assert.deepEqual(
    groupIds(
      createAppSidebarProjectGroups({
        pinnedProjectIds: ["project-a"],
        projects: [],
      })
    ),
    { pinned: [], projects: [] }
  );
});
