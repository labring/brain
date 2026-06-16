export const MAX_PINNED_PROJECTS = 8;

export type AddPinnedProjectIdStatus =
  | "added"
  | "already-pinned"
  | "invalid"
  | "limit-reached";

export type RemovePinnedProjectIdStatus = "not-pinned" | "removed";

export type TogglePinnedProjectIdStatus =
  | AddPinnedProjectIdStatus
  | RemovePinnedProjectIdStatus;

export interface PinnedProjectIdResult<TStatus extends string> {
  ids: string[];
  status: TStatus;
}

function normalizedProjectId(projectId: string): string {
  return projectId.trim();
}

export function normalizePinnedProjectIds(
  value: unknown,
  limit = MAX_PINNED_PROJECTS
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const projectId = normalizedProjectId(item);
    if (projectId === "" || seen.has(projectId)) {
      continue;
    }
    ids.push(projectId);
    seen.add(projectId);
    if (ids.length >= limit) {
      break;
    }
  }
  return ids;
}

export function addPinnedProjectId(
  currentIds: readonly string[],
  projectId: string,
  limit = MAX_PINNED_PROJECTS
): PinnedProjectIdResult<AddPinnedProjectIdStatus> {
  const id = normalizedProjectId(projectId);
  const ids = normalizePinnedProjectIds(currentIds, limit);

  if (id === "") {
    return { ids, status: "invalid" };
  }
  if (ids.includes(id)) {
    return { ids, status: "already-pinned" };
  }
  if (ids.length >= limit) {
    return { ids, status: "limit-reached" };
  }

  return { ids: [...ids, id], status: "added" };
}

export function removePinnedProjectId(
  currentIds: readonly string[],
  projectId: string,
  limit = MAX_PINNED_PROJECTS
): PinnedProjectIdResult<RemovePinnedProjectIdStatus> {
  const id = normalizedProjectId(projectId);
  const ids = normalizePinnedProjectIds(currentIds, limit);
  const nextIds = ids.filter((currentId) => currentId !== id);

  return {
    ids: nextIds,
    status: nextIds.length === ids.length ? "not-pinned" : "removed",
  };
}

export function togglePinnedProjectId(
  currentIds: readonly string[],
  projectId: string,
  limit = MAX_PINNED_PROJECTS
): PinnedProjectIdResult<TogglePinnedProjectIdStatus> {
  const ids = normalizePinnedProjectIds(currentIds, limit);
  const id = normalizedProjectId(projectId);

  if (ids.includes(id)) {
    return removePinnedProjectId(ids, id, limit);
  }
  return addPinnedProjectId(ids, id, limit);
}

export function prunePinnedProjectIds(
  currentIds: readonly string[],
  validProjectIds: ReadonlySet<string>,
  limit = MAX_PINNED_PROJECTS
): string[] {
  return normalizePinnedProjectIds(currentIds, limit).filter((projectId) =>
    validProjectIds.has(projectId)
  );
}

export function pinnedProjectIdsEqual(
  a: readonly string[],
  b: readonly string[]
): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}
