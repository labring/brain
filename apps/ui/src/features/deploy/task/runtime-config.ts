import { DEPLOY_TIMEOUT_POLICY } from "./timeout-policy";

export const DEFAULT_DEPLOY_DEVBOX_STORAGE_LIMIT = "10Gi";

export const DEFAULT_DEPLOY_SKILL_SOURCE =
  "https://github.com/labring/sealos-skills.git#main";

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
