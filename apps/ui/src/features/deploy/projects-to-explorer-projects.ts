import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { ProjectExplorerProject } from "@/features/projects/explorer/project-explorer";

import type { VisualTone } from "@/features/projects/project-aggregate-status";

/** Key on `metadata.annotations` for the UI display name in legacy Project CR rows. */
export const PROJECT_DISPLAY_NAME_ANNOTATION_KEY = "displayName";
export const PROJECT_DESCRIPTION_ANNOTATION_KEY = "description";

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

export function projectDescription(item: ProjectListItem): string | undefined {
  const fromAnnotation =
    item.metadata?.annotations?.[PROJECT_DESCRIPTION_ANNOTATION_KEY]?.trim();
  return fromAnnotation && fromAnnotation.length > 0
    ? fromAnnotation
    : undefined;
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

function projectResourceName(
  meta: ProjectListItem["metadata"]
): string | undefined {
  return typeof meta?.name === "string" && meta.name !== ""
    ? meta.name
    : undefined;
}

function projectRowName(input: {
  displayName: string | undefined;
  id: string;
  resourceName: string | undefined;
}): string {
  return (
    input.displayName ??
    input.resourceName ??
    (input.id === "" ? undefined : input.id) ??
    "Untitled"
  );
}

function projectListItemToExplorerProject(
  item: ProjectListItem,
  index: number,
  statusByProjectId?: ReadonlyMap<string, VisualTone>
): ProjectExplorerProject {
  const meta = item.metadata ?? {};
  const id = meta.uid ?? meta.name ?? `project-${index}`;
  const resourceName = projectResourceName(meta);
  const displayName = projectDisplayName(item);
  const description = projectDescription(item);
  const status = statusByProjectId?.get(id);
  const project: ProjectExplorerProject = {
    createdAt: meta.creationTimestamp ?? "",
    id,
    name: projectRowName({ displayName, id, resourceName }),
  };
  if (description !== undefined) {
    project.description = description;
  }
  if (resourceName !== undefined) {
    project.resourceName = resourceName;
  }
  if (status !== undefined) {
    project.status = status;
  }
  if (item.spec?.public !== null && item.spec?.public !== undefined) {
    project.public = item.spec.public;
  }
  return project;
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
  return items.map((item, index) =>
    projectListItemToExplorerProject(item, index, statusByProjectId)
  );
}
