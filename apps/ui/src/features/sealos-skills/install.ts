export const DEFAULT_SEALOS_SKILLS_SOURCE =
  "https://github.com/labring/sealos-skills.git#codex/unify-main-brain-deploy";

export const SEALOS_SKILLS_CLI_VERSION = "1.5.20";
export const SEALOS_SKILLS_WORKSPACE_DIR = "/home/devbox/project";
export const SEALOS_SKILLS_INSTALL_MARKER = `${SEALOS_SKILLS_WORKSPACE_DIR}/.sealos/sealos-skills-install.marker`;
const SEALOS_SKILLS_INSTALL_MARKER_SCHEMA = "source-install-v1";

/** Internal deployment executor; it is not exposed by the chat Skill loader. */
export const SEALOS_INTERNAL_CHAT_SKILL_NAMES = ["k8s-kaniko-job"] as const;

export function getSealosSkillsSourceFromEnv(
  env: Record<string, string | undefined>
): string {
  return env.DEPLOY_SKILL_SOURCE?.trim() || DEFAULT_SEALOS_SKILLS_SOURCE;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface BuildSealosSkillsInstallCommandOptions {
  skillSource: string;
  skipIfInstallMarkerMatches: boolean;
  timeoutSeconds: number;
}

/**
 * Builds the single installation flow shared by Chat Devboxes and deployment
 * task Devboxes. The configured source owns what gets installed; existing
 * workspace skills and lock files are intentionally preserved.
 */
export function buildSealosSkillsInstallCommand({
  skipIfInstallMarkerMatches,
  skillSource,
  timeoutSeconds,
}: BuildSealosSkillsInstallCommandOptions): string {
  const marker = shellQuote(SEALOS_SKILLS_INSTALL_MARKER);
  const markerContent = `marker_schema=${SEALOS_SKILLS_INSTALL_MARKER_SCHEMA}\nsource=${skillSource}\ncli_version=${SEALOS_SKILLS_CLI_VERSION}`;
  const markerSetup = skipIfInstallMarkerMatches
    ? [
        `install_marker=${marker}`,
        `marker_content=${shellQuote(markerContent)}`,
      ]
    : [];
  const cachedInstallCheck = skipIfInstallMarkerMatches
    ? [
        'if [ -f "$install_marker" ] && [ "$(cat -- "$install_marker")" = "$marker_content" ]; then',
        "  exit 0",
        "fi",
      ]
    : [];
  const markerWrite = skipIfInstallMarkerMatches
    ? ['printf \'%s\' "$marker_content" > "$install_marker"']
    : [];

  return [
    "set -euo pipefail",
    `workspace_dir=${shellQuote(SEALOS_SKILLS_WORKSPACE_DIR)}`,
    `skill_source=${shellQuote(skillSource)}`,
    'install_lock_path="$workspace_dir/.sealos/sealos-skills-install.lock"',
    `install_lock_wait_seconds=${timeoutSeconds}`,
    ...markerSetup,
    'mkdir -p -- "$workspace_dir/.sealos"',
    "if ! command -v npx >/dev/null 2>&1; then",
    "  printf 'ERROR: npx is required to install Sealos skills\\n' >&2",
    "  exit 1",
    "fi",
    "if ! command -v flock >/dev/null 2>&1; then",
    "  printf 'ERROR: flock is required to install Sealos skills safely\\n' >&2",
    "  exit 1",
    "fi",
    'exec 9>"$install_lock_path"',
    'if ! flock --wait "$install_lock_wait_seconds" 9; then',
    "  printf 'ERROR: timed out waiting for the Sealos skills install lock\\n' >&2",
    "  exit 1",
    "fi",
    ...cachedInstallCheck,
    'cd -- "$workspace_dir"',
    `if install_output=$(timeout ${timeoutSeconds} npx --yes skills@${SEALOS_SKILLS_CLI_VERSION} add "$skill_source" --agent codex -y 2>&1); then`,
    "  :",
    "else",
    "  install_exit_code=$?",
    "  printf '%s\\n' \"$install_output\" >&2",
    "  printf 'ERROR: Sealos skills CLI failed with exit code %s\\n' \"$install_exit_code\" >&2",
    '  exit "$install_exit_code"',
    "fi",
    `if printf '%s\\n' "$install_output" | grep -Eq 'Failed to install [1-9][0-9]*'; then`,
    "  printf '%s\\n' \"$install_output\" >&2",
    "  printf 'ERROR: Sealos skills CLI reported installation failures\\n' >&2",
    "  exit 1",
    "fi",
    "printf '%s\\n' \"$install_output\"",
    ...markerWrite,
  ].join("\n");
}
