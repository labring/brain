import { mock, test } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));

const DEPLOY_CONTRACT_PATH_RE =
  /sealos-deploy[/\\]references[/\\]deploy-contract\.md$/;

test("discovers the bundled Sealos skill entries", async () => {
  const { discoverPublicSkills } = await import("./public-skills");
  const skills = await discoverPublicSkills();

  assert.deepEqual(
    skills.map((skill) => skill.name),
    [
      "cloud-native-readiness",
      "docker-to-sealos",
      "dockerfile-skill",
      "sealos-app-builder",
      "sealos-canvas",
      "sealos-database",
      "sealos-deploy",
      "sealos-s3",
    ]
  );
  assert.ok(skills.every((skill) => skill.description.length > 0));
});

test("resolves bundled resources without allowing path traversal", async () => {
  const { discoverPublicSkills, resolvePublicSkillResourcePath } = await import(
    "./public-skills"
  );
  const skills = await discoverPublicSkills();
  const deploy = skills.find((skill) => skill.name === "sealos-deploy");

  assert.ok(deploy);
  assert.match(
    resolvePublicSkillResourcePath(deploy, "references/deploy-contract.md") ??
      "",
    DEPLOY_CONTRACT_PATH_RE
  );
  assert.equal(resolvePublicSkillResourcePath(deploy, ""), null);
  assert.equal(resolvePublicSkillResourcePath(deploy, "."), null);
  assert.equal(resolvePublicSkillResourcePath(deploy, "../SKILL.md"), null);
  assert.equal(
    resolvePublicSkillResourcePath(deploy, "references/../../SKILL.md"),
    null
  );
  assert.equal(
    resolvePublicSkillResourcePath(deploy, "../../../../etc/passwd"),
    null
  );
});
