"use client";

export const DEPLOYMENT_TASK_DOCK_DISMISSALS_STORAGE_PREFIX =
  "sealai:deployment-task-dock-dismissals:";

type DeploymentTaskDockDismissalStorage = Pick<
  Storage,
  "getItem" | "removeItem" | "setItem"
>;

export function deploymentTaskDockDismissalsStorageKey(input: {
  namespace: string;
  projectId: string;
}): string {
  return `${DEPLOYMENT_TASK_DOCK_DISMISSALS_STORAGE_PREFIX}${encodeURIComponent(
    input.namespace.trim()
  )}:${encodeURIComponent(input.projectId.trim())}`;
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function parseDeploymentTaskDockDismissals(
  raw: string | null
): Map<string, string> {
  if (raw == null || raw.trim() === "") {
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Map();
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return new Map();
  }

  const dismissedTaskUpdatedAtById = new Map<string, string>();
  for (const [taskIdRaw, updatedAtRaw] of Object.entries(parsed)) {
    const taskId = normalizeNonEmptyString(taskIdRaw);
    const updatedAt = normalizeNonEmptyString(updatedAtRaw);
    if (taskId === undefined || updatedAt === undefined) {
      continue;
    }
    dismissedTaskUpdatedAtById.set(taskId, updatedAt);
  }
  return dismissedTaskUpdatedAtById;
}

export function serializeDeploymentTaskDockDismissals(
  dismissedTaskUpdatedAtById: ReadonlyMap<string, string>
): string {
  return JSON.stringify(Object.fromEntries(dismissedTaskUpdatedAtById));
}

export function readDeploymentTaskDockDismissals(input: {
  namespace: string;
  projectId: string;
  storage: DeploymentTaskDockDismissalStorage;
}): Map<string, string> {
  try {
    return parseDeploymentTaskDockDismissals(
      input.storage.getItem(deploymentTaskDockDismissalsStorageKey(input))
    );
  } catch {
    return new Map();
  }
}

export function readBrowserDeploymentTaskDockDismissals(input: {
  namespace: string;
  projectId: string;
}): Map<string, string> {
  if (typeof window === "undefined") {
    return new Map();
  }
  return readDeploymentTaskDockDismissals({
    ...input,
    storage: window.localStorage,
  });
}

export function writeDeploymentTaskDockDismissals(input: {
  dismissedTaskUpdatedAtById: ReadonlyMap<string, string>;
  namespace: string;
  projectId: string;
  storage: DeploymentTaskDockDismissalStorage;
}) {
  const key = deploymentTaskDockDismissalsStorageKey(input);
  try {
    if (input.dismissedTaskUpdatedAtById.size === 0) {
      input.storage.removeItem(key);
      return;
    }
    input.storage.setItem(
      key,
      serializeDeploymentTaskDockDismissals(input.dismissedTaskUpdatedAtById)
    );
  } catch {
    // Local browser persistence is best-effort; in-memory state still updates.
  }
}

export function writeBrowserDeploymentTaskDockDismissals(input: {
  dismissedTaskUpdatedAtById: ReadonlyMap<string, string>;
  namespace: string;
  projectId: string;
}) {
  if (typeof window === "undefined") {
    return;
  }
  writeDeploymentTaskDockDismissals({
    ...input,
    storage: window.localStorage,
  });
}
