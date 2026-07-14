"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  LAST_VIEWED_PROJECT_STORAGE_PREFIX,
  lastViewedProjectStorageKey,
  normalizeLastViewedProjectId,
} from "@/features/projects/project-navigation-memory";

const LAST_VIEWED_PROJECT_CHANGED_EVENT = "sealai:last-viewed-project-changed";

function readStoredLastViewedProjectId(namespace: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  try {
    return normalizeLastViewedProjectId(
      window.localStorage.getItem(lastViewedProjectStorageKey(namespace))
    );
  } catch {
    return undefined;
  }
}

function writeStoredLastViewedProjectId(
  namespace: string,
  projectId: string | undefined
) {
  if (typeof window === "undefined") {
    return;
  }

  const key = lastViewedProjectStorageKey(namespace);
  try {
    if (projectId === undefined) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, projectId);
    }
    window.dispatchEvent(
      new CustomEvent(LAST_VIEWED_PROJECT_CHANGED_EVENT, { detail: { key } })
    );
  } catch {
    // Local storage may be unavailable in private or restricted contexts.
  }
}

function subscribeLastViewedProjectId(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const onStorage = (event: StorageEvent) => {
    if (
      event.key == null ||
      event.key.startsWith(LAST_VIEWED_PROJECT_STORAGE_PREFIX)
    ) {
      onStoreChange();
    }
  };
  const onLocalChange = () => onStoreChange();

  window.addEventListener("storage", onStorage);
  window.addEventListener(LAST_VIEWED_PROJECT_CHANGED_EVENT, onLocalChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(
      LAST_VIEWED_PROJECT_CHANGED_EVENT,
      onLocalChange
    );
  };
}

export function useLastViewedProject(namespace: string): {
  lastViewedProjectId: string | undefined;
  setLastViewedProject: (projectId: string | undefined) => void;
} {
  const storageNamespace = namespace.trim();
  const getSnapshot = useCallback(
    () => readStoredLastViewedProjectId(storageNamespace),
    [storageNamespace]
  );
  const lastViewedProjectId = useSyncExternalStore(
    subscribeLastViewedProjectId,
    getSnapshot,
    () => undefined
  );

  const setLastViewedProject = useCallback(
    (projectId: string | undefined) => {
      const normalizedProjectId = normalizeLastViewedProjectId(projectId);
      if (normalizedProjectId === lastViewedProjectId) {
        return;
      }
      writeStoredLastViewedProjectId(storageNamespace, normalizedProjectId);
    },
    [lastViewedProjectId, storageNamespace]
  );

  return {
    lastViewedProjectId,
    setLastViewedProject,
  };
}
