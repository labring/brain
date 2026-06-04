import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { ProjectExplorerProject } from "@workspace/ui/components/project-explorer/project-explorer";

import type { VisualTone } from "./project-aggregate-status";

/** Key on `metadata.annotations` for the UI display name (merge-patched on rename). */
export const PROJECT_DISPLAY_NAME_ANNOTATION_KEY = "displayName";

/** Legacy project-list item shape kept for old parser tests and transition helpers. */
export interface ProjectListItem {
  metadata?: {
    creationTimestamp?: string;
    name?: string;
    uid?: string;
    annotations?: Record<string, string>;
  };
  spec?: {
    public?: boolean;
    /** Legacy display fallback when {@link PROJECT_DISPLAY_NAME_ANNOTATION_KEY} is unset. */
    title?: string;
  };
}

interface ProjectListEnvelope {
  items?: ProjectListItem[];
}

export function projectItemsFromK8sGetResponse(
  data: K8sGetResponse | undefined
): ProjectListItem[] | undefined {
  if (data == null || typeof data !== "object") {
    return undefined;
  }
  const root = data as Record<string, unknown>;
  if (Array.isArray(root.items)) {
    return root.items as ProjectListItem[];
  }
  const nested = root.data;
  if (nested != null && typeof nested === "object") {
    const items = (nested as ProjectListEnvelope).items;
    if (Array.isArray(items)) {
      return items;
    }
  }
  return undefined;
}

export function projectDisplayName(item: ProjectListItem): string | undefined {
  const fromAnnotation =
    item.metadata?.annotations?.[PROJECT_DISPLAY_NAME_ANNOTATION_KEY]?.trim();
  if (fromAnnotation && fromAnnotation.length > 0) {
    return fromAnnotation;
  }
  const legacyTitle = item.spec?.title?.trim();
  if (legacyTitle && legacyTitle.length > 0) {
    return legacyTitle;
  }
  return undefined;
}

export function normalizeProjectDisplayName(name: string): string {
  return name.trim().toLowerCase();
}

export function isProjectDisplayNameTaken(
  projects: readonly ProjectExplorerProject[],
  displayName: string,
  ignoreProjectId?: string
): boolean {
  const normalized = normalizeProjectDisplayName(displayName);
  if (normalized === "") {
    return false;
  }
  return projects.some(
    (project) =>
      project.id !== ignoreProjectId &&
      normalizeProjectDisplayName(project.name) === normalized
  );
}

/**
 * Maps a Project list (or unknown k8s get / SWR `data` payload) into
 * {@link ProjectExplorerProject} rows for {@link ProjectExplorer}.
 *
 * When `statusByProjectId` is provided, each row's `status` is set from the
 * map keyed by project ID (rows with no entry are left without a status,
 * which the renderer treats as a static neutral dot).
 */
export function projectsListToExplorerProjects(
  data: K8sGetResponse | undefined,
  statusByProjectId?: ReadonlyMap<string, VisualTone>
): ProjectExplorerProject[] {
  const items = projectItemsFromK8sGetResponse(data);
  if (!items) {
    return [];
  }
  return items.map((item, index) => {
    const meta = item.metadata ?? {};
    const id = meta.uid ?? meta.name ?? `project-${index}`;
    const resourceName =
      typeof meta.name === "string" && meta.name !== "" ? meta.name : undefined;
    const displayName = projectDisplayName(item);
    let name =
      displayName ??
      resourceName ??
      (typeof id === "string" && id !== "" ? id : undefined);
    if (!name || name === "") {
      name = "Untitled";
    }
    const createdAt = meta.creationTimestamp ?? "";
    const specPublic = item.spec?.public;
    const status = statusByProjectId?.get(id);
    const base: ProjectExplorerProject = {
      id,
      name,
      createdAt,
      ...(resourceName === undefined ? {} : { resourceName }),
      ...(status === undefined ? {} : { status }),
    };
    if (specPublic === null || specPublic === undefined) {
      return base;
    }
    return { ...base, public: specPublic };
  });
}
