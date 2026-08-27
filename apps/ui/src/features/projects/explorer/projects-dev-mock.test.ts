import assert from "node:assert/strict";
import { test } from "node:test";

import { generateProjectsDevMockSnapshot } from "./projects-dev-mock";

test("generateProjectsDevMockSnapshot is deterministic and respects count", () => {
  const first = generateProjectsDevMockSnapshot("plain", 12);
  const second = generateProjectsDevMockSnapshot("plain", 12);

  assert.equal(first.projects.length, 12);
  assert.deepEqual(first.projects, second.projects);
  assert.deepEqual([...first.projectIconKeys], [...second.projectIconKeys]);

  const ids = new Set(first.projects.map((project) => project.id));
  assert.equal(ids.size, 12);

  assert.equal(generateProjectsDevMockSnapshot("plain", 0).projects.length, 0);
});

test("edge scenario cycles every Project Aggregate Status tone", () => {
  const { projects } = generateProjectsDevMockSnapshot("edge", 24);
  const tones = new Set(projects.map((project) => project.status));
  for (const tone of [
    "negative",
    "neutral",
    "positive",
    "progress",
    "warning",
  ]) {
    assert.ok(tones.has(tone as never), `missing tone ${tone}`);
  }
  // `undefined` keeps the static neutral dot path exercised too.
  assert.ok(tones.has(undefined));
});

test("every third row omits its Project Icon to exercise the fallback", () => {
  const { projectIconKeys, projects } = generateProjectsDevMockSnapshot(
    "plain",
    9
  );
  projects.forEach((project, index) => {
    assert.equal(projectIconKeys.has(project.id), index % 3 !== 2);
  });
});
