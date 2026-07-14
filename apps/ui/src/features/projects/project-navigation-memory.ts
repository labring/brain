export const LAST_VIEWED_PROJECT_STORAGE_PREFIX = "sealai:last-viewed-project:";

function normalizedProjectId(projectId: string): string {
  return projectId.trim();
}

export function lastViewedProjectStorageKey(namespace: string): string {
  return `${LAST_VIEWED_PROJECT_STORAGE_PREFIX}${encodeURIComponent(
    namespace.trim()
  )}`;
}

export function normalizeLastViewedProjectId(
  value: unknown
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const projectId = normalizedProjectId(value);
  return projectId === "" ? undefined : projectId;
}
