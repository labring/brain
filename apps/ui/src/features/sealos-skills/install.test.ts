import { expect, test } from "bun:test";
import {
  assertBundledSkillsConfiguration,
  buildSealosSkillsInstallCommand,
} from "./install";

test("managed runtimes prepare Skills locally without a download fallback", () => {
  const command = buildSealosSkillsInstallCommand();
  expect(command).toContain("test -x /usr/local/bin/sealai-prepare-skills");
  expect(command).toContain("\n/usr/local/bin/sealai-prepare-skills");
  for (const forbidden of ["npx", "npm", "git clone", "https://", "rm -rf"]) {
    expect(command).not.toContain(forbidden);
  }
});

test("legacy source overrides must be migrated, not silently ignored", () => {
  expect(() => assertBundledSkillsConfiguration({})).not.toThrow();
  expect(() =>
    assertBundledSkillsConfiguration({ DEPLOY_SKILL_SOURCE: " " })
  ).not.toThrow();
  expect(() =>
    assertBundledSkillsConfiguration({
      DEPLOY_SKILL_SOURCE: "https://example.test/skills",
    })
  ).toThrow("DEVBOX_RUNTIME_IMAGE");
});

test("only Chat explicitly initializes a workspace without repository cloning", () => {
  expect(
    buildSealosSkillsInstallCommand({ initializeWorkspace: true })
  ).toContain(" --init-workspace");
  expect(buildSealosSkillsInstallCommand()).not.toContain(" --init-workspace");
});
