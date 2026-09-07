export const DEFAULT_SEALOS_SKILLS_SOURCE =
  "https://github.com/labring/sealos-skills.git#codex/unify-main-brain-deploy";

/** Only used by the user-facing local installation guide. */
export const SEALOS_SKILLS_CLI_VERSION = "1.5.20";
export const SEALOS_SKILLS_WORKSPACE_DIR = "/home/devbox/project";
export const SEALOS_SKILLS_RUNTIME_CONTRACT = "bundled-skills-v1";
export const SEALOS_INTERNAL_CHAT_SKILL_NAMES = ["k8s-kaniko-job"] as const;

/** Legacy configuration is rejected instead of silently using another source. */
export function assertBundledSkillsConfiguration(
  env: Record<string, string | undefined>
): void {
  if (env.DEPLOY_SKILL_SOURCE?.trim()) {
    throw new Error(
      "DEPLOY_SKILL_SOURCE is no longer supported. Select a runtime image containing the desired Skill revision using DEVBOX_RUNTIME_IMAGE."
    );
  }
}

/** Offline preparation is owned by the runtime image; never invoke npx here. */
export function buildSealosSkillsInstallCommand(): string {
  return [
    "set -euo pipefail",
    "test -x /usr/local/bin/sealai-prepare-skills",
    "/usr/local/bin/sealai-prepare-skills",
  ].join("\n");
}
