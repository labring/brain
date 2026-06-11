import type { CanvasNodeVisualStatusTone } from "@workspace/ui/components/canvas-node/canvas-node.types";

export interface ProjectExplorerProject {
  createdAt: Date | string;
  id: string;
  /** Display name (preferred: `metadata.annotations.displayName`, else legacy `spec.title`). */
  name: string;
  /** `spec.public` on the Project claim when known. */
  public?: boolean;
  /** Kubernetes `metadata.name`; defaults to `name` when omitted (legacy rows). */
  resourceName?: string;
  /**
   * Project Aggregate Status tone, derived from sibling AP and DB phases (see
   * CONTEXT.md). Optional so legacy callers and the loading/empty paths can
   * omit it and render a static neutral dot.
   */
  status?: CanvasNodeVisualStatusTone;
}

/** Copy shown when `projects` is empty (list uses defaults when fields are omitted). */
export interface ProjectExplorerEmptyState {
  /** Set to `""` to hide the secondary line. */
  description?: string;
  title?: string;
}

/** Display state for the explorer (passed into Root as `states`). */
export interface ProjectExplorerStates {
  /**
   * When `projects` has no items, the list shows an empty state.
   * Set `title` / `description` to customize; strings default when omitted.
   */
  empty?: ProjectExplorerEmptyState;
  projects: ProjectExplorerProject[];
}

/** Optional handlers for project rows. */
export interface ProjectExplorerActions {
  /** Opens the create-project flow when the header action is used. */
  onNewProject?: () => void;
  onProjectClick?: (project: ProjectExplorerProject) => void;
  onProjectDelete?: (project: ProjectExplorerProject) => void | Promise<void>;
  /**
   * Display rename; typically merge-PATCH `metadata.annotations.displayName` while
   * keeping `metadata.name` ({@link ProjectExplorerProject.resourceName}).
   */
  onProjectRename?: (
    project: ProjectExplorerProject,
    newDisplayName: string
  ) => void | Promise<void>;
}

export interface ProjectExplorerValue {
  actions: ProjectExplorerActions;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  states: ProjectExplorerStates;
}
