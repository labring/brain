import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  buildSealosSkillsInstallCommand,
  DEFAULT_SEALOS_SKILLS_SOURCE,
  getSealosSkillsSourceFromEnv,
  SEALOS_CHAT_SKILL_NAMES,
} from "./install";

const INSTALL_MARKER_RE = /sealos-skills-install\.marker/;
const IDEMPOTENCY_RE = /skills_ready=true/;
const CLI_VERSION_RE = /skills@1\.5\.20/;
const DEPLOY_SKILL_RE = /sealos-deploy/;
const INTERNAL_SKILL_RE = /required_skill_names=.*k8s-kaniko-job/;
const KANIKO_SKILL_RE = /k8s-kaniko-job/;
const QUOTED_SOURCE_RE = /branch\/it.*s-safe/;
const LOCK_RE = /flock --wait/;

test("Sealos Skills source defaults to the shared deployment branch", () => {
  assert.equal(getSealosSkillsSourceFromEnv({}), DEFAULT_SEALOS_SKILLS_SOURCE);
  assert.equal(
    getSealosSkillsSourceFromEnv({ DEPLOY_SKILL_SOURCE: "  " }),
    DEFAULT_SEALOS_SKILLS_SOURCE
  );
  assert.equal(
    getSealosSkillsSourceFromEnv({
      DEPLOY_SKILL_SOURCE: " https://example.test/sealos-skills.git#main ",
    }),
    "https://example.test/sealos-skills.git#main"
  );
});

test("chat install command is idempotent and excludes the internal executor", () => {
  const command = buildSealosSkillsInstallCommand({
    force: false,
    requiredSkillNames: SEALOS_CHAT_SKILL_NAMES,
    skillSource: DEFAULT_SEALOS_SKILLS_SOURCE,
    timeoutSeconds: 180,
  });

  assert.match(command, INSTALL_MARKER_RE);
  assert.match(command, LOCK_RE);
  assert.ok(
    command.indexOf("flock --wait") < command.indexOf("skills_ready=true")
  );
  assert.match(command, IDEMPOTENCY_RE);
  assert.match(command, CLI_VERSION_RE);
  assert.match(command, DEPLOY_SKILL_RE);
  assert.doesNotMatch(command, INTERNAL_SKILL_RE);
});

test("deployment install command always reinstalls and shell-quotes the source", () => {
  const source = "https://example.test/sealos-skills.git#branch/it's-safe";
  const command = buildSealosSkillsInstallCommand({
    force: true,
    requiredSkillNames: ["sealos-deploy", "k8s-kaniko-job"],
    skillSource: source,
    timeoutSeconds: 180,
  });

  assert.doesNotMatch(command, IDEMPOTENCY_RE);
  assert.match(command, LOCK_RE);
  assert.ok(command.indexOf("flock --wait") < command.indexOf("rm -rf"));
  assert.match(command, KANIKO_SKILL_RE);
  assert.match(command, QUOTED_SOURCE_RE);
});
