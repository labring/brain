export const DEFAULT_DEPLOY_DEVBOX_STORAGE_LIMIT = "10Gi";

export const DEPLOY_DEVBOX_RUNTIME_READY_TIMEOUT_MS = 60 * 60_000;

export function getDeployDevboxStorageLimitFromEnv(
  env: Record<string, string | undefined>
): string {
  return (
    env.DEPLOY_DEVBOX_STORAGE_LIMIT?.trim() ||
    DEFAULT_DEPLOY_DEVBOX_STORAGE_LIMIT
  );
}
