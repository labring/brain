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
const INSTALL_OUTPUT_STDERR_RE = /install_output" >&2/g;
const MARKER_CLI_VERSION_RE = /cli_version=1\.5\.20/;
const MARKER_SCHEMA_RE = /marker_schema=source-install-v1/;
const MARKER_SOURCE_RE = /source=.*sealos-skills/;
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
    skipIfInstallMarkerMatches: false,
    skillSource: DEFAULT_SEALOS_SKILLS_SOURCE,
    timeoutSeconds: 180,
  });

  assert.doesNotMatch(command, INSTALL_MARKER_RE);
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
    skipIfInstallMarkerMatches: false,
    skillSource: source,
    timeoutSeconds: 180,
  });

  assert.match(command, LOCK_RE);
  assert.match(command, QUOTED_SOURCE_RE);
  assert.doesNotMatch(command, WORKSPACE_CLEANUP_RE);
  assert.doesNotMatch(command, SKILL_NAME_VALIDATION_RE);
});

test("Chat install cache skips only a matching successful source and CLI version", () => {
  const command = buildSealosSkillsInstallCommand({
    skipIfInstallMarkerMatches: true,
    skillSource: DEFAULT_SEALOS_SKILLS_SOURCE,
    timeoutSeconds: 180,
  });

  assert.match(command, INSTALL_MARKER_RE);
  assert.match(command, MARKER_SCHEMA_RE);
  assert.match(command, MARKER_SOURCE_RE);
  assert.match(command, MARKER_CLI_VERSION_RE);
  assert.ok(
    command.indexOf("flock --wait") <
      command.indexOf('cat -- "$install_marker"')
  );
  assert.ok(
    command.indexOf('cat -- "$install_marker"') <
      command.indexOf("install_output")
  );
  assert.ok(
    command.indexOf("install_output") <
      command.lastIndexOf('> "$install_marker"')
  );
});

test("installation failures send captured CLI output to stderr before exiting", () => {
  const command = buildSealosSkillsInstallCommand({
    skipIfInstallMarkerMatches: true,
    skillSource: DEFAULT_SEALOS_SKILLS_SOURCE,
    timeoutSeconds: 180,
  });

  const stderrWrites = command.match(INSTALL_OUTPUT_STDERR_RE) ?? [];
  assert.equal(stderrWrites.length, 2);
  assert.ok(
    command.indexOf("CLI reported installation failures") <
      command.lastIndexOf('> "$install_marker"')
  );
});
