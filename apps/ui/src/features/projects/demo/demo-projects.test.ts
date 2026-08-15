import { describe, expect, test } from "bun:test";

import { generateDemoProjects } from "@/features/projects/demo/demo-projects";

describe("generateDemoProjects", () => {
  test("is deterministic for the same seed and count", () => {
    const a = generateDemoProjects({ count: 12, seed: 1 });
    const b = generateDemoProjects({ count: 12, seed: 1 });
    expect(a.projects).toEqual(b.projects);
    expect([...a.iconKeys.entries()]).toEqual([...b.iconKeys.entries()]);
  });

  test("growing the count appends without reshuffling earlier rows", () => {
    const small = generateDemoProjects({ count: 12, seed: 7 });
    const large = generateDemoProjects({ count: 50, seed: 7 });
    expect(large.projects.slice(0, 12)).toEqual(small.projects);
  });

  test("changing the seed regenerates ids and names", () => {
    const a = generateDemoProjects({ count: 12, seed: 1 });
    const b = generateDemoProjects({ count: 12, seed: 2 });
    expect(a.projects[0]?.id).not.toBe(b.projects[0]?.id);
    const namesA = a.projects.map((project) => project.name).join("|");
    const namesB = b.projects.map((project) => project.name).join("|");
    expect(namesA).not.toBe(namesB);
  });

  test("keeps the boundary samples at their fixed indices", () => {
    const { projects } = generateDemoProjects({ count: 12, seed: 5 });
    expect(projects[2]?.name).toBe(
      "customer-feedback-sentiment-analysis-pipeline-legacy-migration-v2"
    );
    expect(projects[6]?.name).toBe("内部运营数据看板");
    expect(projects[9]?.name).toBe("ml");
  });

  test("names and ids stay unique at the maximum count", () => {
    const { iconKeys, projects } = generateDemoProjects({
      count: 200,
      seed: 3,
    });
    expect(projects).toHaveLength(200);
    expect(new Set(projects.map((project) => project.id)).size).toBe(200);
    expect(new Set(projects.map((project) => project.name)).size).toBe(200);
    for (const project of projects) {
      expect(iconKeys.has(project.id)).toBe(true);
    }
  });

  test("clamps count to the supported range", () => {
    expect(generateDemoProjects({ count: -5, seed: 1 }).projects).toHaveLength(
      0
    );
    expect(
      generateDemoProjects({ count: 10_000, seed: 1 }).projects
    ).toHaveLength(200);
  });
});
