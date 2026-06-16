import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type BrainProject,
  brainProjectsToExplorerProjects,
  isProjectDisplayNameTaken,
  normalizeProjectDisplayName,
} from "./brain-projects";

function project(
  id: string,
  displayName: string,
  createdAt = "2026-01-01T00:00:00.000Z",
  description = ""
): BrainProject {
  return {
    createdAt,
    description,
    displayName,
    id,
    namespace: "ns",
    updatedAt: createdAt,
  };
}

describe("Brain projects", () => {
  test("normalizes project display names", () => {
    assert.equal(normalizeProjectDisplayName("  demo  "), "demo");
  });

  test("detects duplicate display names case-insensitively", () => {
    const projects = [
      { createdAt: "2026-01-01T00:00:00.000Z", id: "p1", name: "Demo" },
    ];
    assert.equal(isProjectDisplayNameTaken(projects, "demo"), true);
    assert.equal(isProjectDisplayNameTaken(projects, "demo", "p1"), false);
  });

  test("maps Brain DB projects into explorer projects", () => {
    assert.deepEqual(
      brainProjectsToExplorerProjects({
        projects: [project("p1", "Demo", undefined, "Orders API")],
      }),
      [
        {
          createdAt: "2026-01-01T00:00:00.000Z",
          description: "Orders API",
          id: "p1",
          name: "Demo",
          resourceName: "p1",
        },
      ]
    );
  });
});
