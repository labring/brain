import { DEPLOY_TIMEOUT_POLICY } from "./timeout-policy";

export const DEFAULT_DEPLOY_DEVBOX_STORAGE_LIMIT = "10Gi";

export const DEFAULT_DEPLOY_SKILL_SOURCE =
  "https://github.com/labring/sealos-skills/tree/brain-deploy";
export const AGENT_DEPLOY_SKILL_SOURCE =
  "https://github.com/labring/sealos-skills";

export const DEFAULT_AI_DEPLOY_EXECUTION_MODE = "brain" as const;

export type AiDeployExecutionMode = "agent" | "brain";

const FULL_GIT_COMMIT_RE = /^[0-9a-f]{40}$/i;
const GIT_SUFFIX_RE = /\.git$/;

export const DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS =
  DEPLOY_TIMEOUT_POLICY.devboxReadyMs;

export function getDeployDevboxStorageLimitFromEnv(
  env: Record<string, string | undefined>
): string {
  return (
    env.DEPLOY_DEVBOX_STORAGE_LIMIT?.trim() ||
    DEFAULT_DEPLOY_DEVBOX_STORAGE_LIMIT
  );
}

export function getDeploySkillSourceFromEnv(
  env: Record<string, string | undefined>
): string {
  if (getAiDeployExecutionModeFromEnv(env) === "brain") {
    return env.DEPLOY_SKILL_SOURCE?.trim() || DEFAULT_DEPLOY_SKILL_SOURCE;
  }
  const revision = getDeploySkillRevisionFromEnv(env);
  if (revision == null) {
    throw new Error(
      "DEPLOY_SKILL_REVISION must be a full Git commit SHA in agent execution mode."
    );
  }
  return pinnedGithubSkillSource(AGENT_DEPLOY_SKILL_SOURCE, revision);
}

export function getAiDeployExecutionModeFromEnv(
  env: Record<string, string | undefined>
): AiDeployExecutionMode {
  const value = env.SEALAI_AI_DEPLOY_EXECUTION_MODE?.trim();
  if (!value) {
    return DEFAULT_AI_DEPLOY_EXECUTION_MODE;
  }
  if (value === "agent" || value === "brain") {
    return value;
  }
  throw new Error(
    "SEALAI_AI_DEPLOY_EXECUTION_MODE must be either 'brain' or 'agent'."
  );
}

export function getDeploySkillRevisionFromEnv(
  env: Record<string, string | undefined>
): string | null {
  const revision = env.DEPLOY_SKILL_REVISION?.trim();
  if (!revision) {
    if (getAiDeployExecutionModeFromEnv(env) === "agent") {
      throw new Error(
        "DEPLOY_SKILL_REVISION must be a full Git commit SHA in agent execution mode."
      );
    }
    return null;
  }
  if (!FULL_GIT_COMMIT_RE.test(revision)) {
    throw new Error("DEPLOY_SKILL_REVISION must be a full Git commit SHA.");
  }
  return revision.toLowerCase();
}

function pinnedGithubSkillSource(source: string, revision: string): string {
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error(
      "DEPLOY_SKILL_SOURCE must be a GitHub HTTPS repository URL when DEPLOY_SKILL_REVISION is set."
    );
  }
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const hasSupportedPath =
    pathSegments.length === 2 ||
    (pathSegments.length >= 4 && pathSegments[2] === "tree");
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    !hasSupportedPath
  ) {
    throw new Error(
      "DEPLOY_SKILL_SOURCE must be a GitHub HTTPS repository URL when DEPLOY_SKILL_REVISION is set."
    );
  }
  const owner = pathSegments[0];
  const repository = pathSegments[1]?.replace(GIT_SUFFIX_RE, "");
  if (!(owner && repository)) {
    throw new Error(
      "DEPLOY_SKILL_SOURCE must include a GitHub owner and repository."
    );
  }
  return `https://github.com/${owner}/${repository}/tree/${revision}`;
}
