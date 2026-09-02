import type { ProjectIconKeyMap } from "@/features/projects/project-icons";
import type { ProjectExplorerProject } from "./project-explorer.types";

/**
 * Session-only bridge between the Projects Dev Mock (dev/demo bundles only)
 * and `useProjectsExplorerModel` (every bundle). The read model subscribes
 * here; the gated mock module is the only writer. Kept free of
 * `@workspace/dev-tweaks` imports so production carries just this stub with
 * a forever-null snapshot.
 */
export interface ProjectsExplorerDevMockSnapshot {
  /** Presentation-only Project Icon keys for the generated rows. */
  projectIconKeys: ProjectIconKeyMap;
  projects: ProjectExplorerProject[];
}

let snapshot: ProjectsExplorerDevMockSnapshot | null = null;
const listeners = new Set<() => void>();

/** `null` means the mock is off and real data flows untouched. */
export function getProjectsExplorerDevMockSnapshot(): ProjectsExplorerDevMockSnapshot | null {
  return snapshot;
}

export function setProjectsExplorerDevMockSnapshot(
  next: ProjectsExplorerDevMockSnapshot | null
): void {
  if (next === snapshot) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeProjectsExplorerDevMock(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
