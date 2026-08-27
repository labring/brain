import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  buildSealosSkillsInstallCommand,
  DEFAULT_SEALOS_SKILLS_SOURCE,
  getSealosSkillsSourceFromEnv,
} from "./install";

const INSTALL_MARKER_RE = /sealos-skills-install\.marker/;
const CLI_VERSION_RE = /skills@1\.5\.20/;
const CODEX_AGENT_RE = /--agent codex -y/;
const INSTALL_FAILURE_RE = /Failed to install/;
const QUOTED_SOURCE_RE = /branch\/it.*s-safe/;
const LOCK_RE = /flock --wait/;
const SKILL_NAME_VALIDATION_RE =
  /required_skill_names|required Sealos skill|cloud-native-readiness|sealos-deploy|k8s-kaniko-job/;
const WORKSPACE_CLEANUP_RE =
  /rm -rf.*(?:\.agents\/skills|\.codex\/skills)|rm -f.*skills-lock\.json/;

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

test("shared install command always installs the configured source for Codex", () => {
  const command = buildSealosSkillsInstallCommand({
    skillSource: DEFAULT_SEALOS_SKILLS_SOURCE,
    timeoutSeconds: 180,
  });

  assert.match(command, INSTALL_MARKER_RE);
  assert.match(command, LOCK_RE);
  assert.ok(
    command.indexOf("flock --wait") < command.indexOf("install_output")
  );
  assert.match(command, CLI_VERSION_RE);
  assert.match(command, CODEX_AGENT_RE);
  assert.match(command, INSTALL_FAILURE_RE);
  assert.doesNotMatch(command, WORKSPACE_CLEANUP_RE);
  assert.doesNotMatch(command, SKILL_NAME_VALIDATION_RE);
});

test("installation command shell-quotes the source and preserves the workspace", () => {
  const source = "https://example.test/sealos-skills.git#branch/it's-safe";
  const command = buildSealosSkillsInstallCommand({
    skillSource: source,
    timeoutSeconds: 180,
  });

  assert.match(command, LOCK_RE);
  assert.match(command, QUOTED_SOURCE_RE);
  assert.doesNotMatch(command, WORKSPACE_CLEANUP_RE);
  assert.doesNotMatch(command, SKILL_NAME_VALIDATION_RE);
});
