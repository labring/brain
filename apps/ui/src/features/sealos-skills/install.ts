export const DEFAULT_SEALOS_SKILLS_SOURCE =
  "https://github.com/labring/sealos-skills.git#codex/unify-main-brain-deploy";

export const SEALOS_SKILLS_CLI_VERSION = "1.5.20";
export const SEALOS_SKILLS_WORKSPACE_DIR = "/home/devbox/project";
export const SEALOS_SKILLS_INSTALL_MARKER = `${SEALOS_SKILLS_WORKSPACE_DIR}/.sealos/sealos-skills-install.marker`;

/** Skills installed by the shared Sealos skills repository. */
export const SEALOS_SKILL_NAMES = [
  "cloud-native-readiness",
  "docker-to-sealos",
  "dockerfile-skill",
  "k8s-kaniko-job",
  "sealos-app-builder",
  "sealos-canvas",
  "sealos-database",
  "sealos-deploy",
  "sealos-s3",
] as const;

/** Internal deployment executor; it is not exposed by the chat Skill loader. */
export const SEALOS_INTERNAL_CHAT_SKILL_NAMES = ["k8s-kaniko-job"] as const;

export const SEALOS_CHAT_SKILL_NAMES = SEALOS_SKILL_NAMES.filter(
  (name) =>
    !SEALOS_INTERNAL_CHAT_SKILL_NAMES.includes(
      name as (typeof SEALOS_INTERNAL_CHAT_SKILL_NAMES)[number]
    )
);

export function getSealosSkillsSourceFromEnv(
  env: Record<string, string | undefined>
): string {
  return env.DEPLOY_SKILL_SOURCE?.trim() || DEFAULT_SEALOS_SKILLS_SOURCE;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function shellArray(values: readonly string[]): string {
  return values.map((value) => shellQuote(value)).join(" ");
}

export interface BuildSealosSkillsInstallCommandOptions {
  force: boolean;
  requiredSkillNames: readonly string[];
  skillSource: string;
  timeoutSeconds: number;
}

/**
 * Builds the single installation flow shared by Chat Devboxes and deployment
 * task Devboxes. Chat uses marker-based idempotency; deployment tasks force a
 * fresh install after preparing their workspace.
 */
export function buildSealosSkillsInstallCommand({
  force,
  requiredSkillNames,
  skillSource,
  timeoutSeconds,
}: BuildSealosSkillsInstallCommandOptions): string {
  const requiredNames = [...new Set(requiredSkillNames)];
  const cleanupNames = [...new Set(SEALOS_SKILL_NAMES)];
  const marker = shellQuote(SEALOS_SKILLS_INSTALL_MARKER);
  const markerContent = `source=${skillSource}\ncli_version=${SEALOS_SKILLS_CLI_VERSION}\n`;

  return [
    "set -euo pipefail",
    `workspace_dir=${shellQuote(SEALOS_SKILLS_WORKSPACE_DIR)}`,
    `skill_source=${shellQuote(skillSource)}`,
    `install_marker=${marker}`,
    `required_skill_names=(${shellArray(requiredNames)})`,
    `cleanup_skill_names=(${shellArray(cleanupNames)})`,
    `marker_content=${shellQuote(markerContent)}`,
    'mkdir -p -- "$workspace_dir/.sealos"',
    "if ! command -v npx >/dev/null 2>&1; then",
    "  printf 'ERROR: npx is required to install Sealos skills\\n' >&2",
    "  exit 1",
    "fi",
    ...(force
      ? []
      : [
          "skills_ready=true",
          `if [ ! -f "$install_marker" ] || ! grep -Fxq "source=$skill_source" "$install_marker" || ! grep -Fxq "cli_version=${SEALOS_SKILLS_CLI_VERSION}" "$install_marker"; then`,
          "  skills_ready=false",
          "fi",
          `for skill_name in "\${required_skill_names[@]}"; do`,
          '  if [ ! -f "$workspace_dir/.agents/skills/$skill_name/SKILL.md" ] && [ ! -f "$workspace_dir/.codex/skills/$skill_name/SKILL.md" ]; then',
          "    skills_ready=false",
          "  fi",
          "done",
          'if [ "$skills_ready" = true ]; then',
          "  exit 0",
          "fi",
        ]),
    `for skill_name in "\${cleanup_skill_names[@]}"; do`,
    '  rm -rf -- "$workspace_dir/.agents/skills/$skill_name"',
    '  rm -rf -- "$workspace_dir/.codex/skills/$skill_name"',
    "done",
    'cd -- "$workspace_dir"',
    `timeout ${timeoutSeconds} npx --yes skills@${SEALOS_SKILLS_CLI_VERSION} add "$skill_source" -y`,
    `for skill_name in "\${required_skill_names[@]}"; do`,
    '  if [ ! -f "$workspace_dir/.agents/skills/$skill_name/SKILL.md" ] && [ ! -f "$workspace_dir/.codex/skills/$skill_name/SKILL.md" ]; then',
    "    printf 'ERROR: required Sealos skill missing after install: %s\\n' \"$skill_name\" >&2",
    "    exit 1",
    "  fi",
    "done",
    'printf \'%s\' "$marker_content" > "$install_marker"',
  ].join("\n");
}
