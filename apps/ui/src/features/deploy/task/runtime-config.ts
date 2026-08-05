import { DEPLOY_TIMEOUT_POLICY } from "./timeout-policy";

export const DEFAULT_DEPLOY_DEVBOX_STORAGE_LIMIT = "10Gi";

export const DEFAULT_DEPLOY_SKILL_SOURCE =
  "https://github.com/labring/sealos-skills/tree/brain-deploy";

export const DEFAULT_AI_DEPLOY_EXECUTION_MODE = "brain" as const;

export type AiDeployExecutionMode = "agent" | "brain";

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
  return env.DEPLOY_SKILL_SOURCE?.trim() || DEFAULT_DEPLOY_SKILL_SOURCE;
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
