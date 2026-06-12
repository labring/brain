import { API_ROUTES } from "@workspace/api/constants";
import {
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_PROJECT_ID_LABEL,
} from "@/lib/brain-labels";
import { kubeconfigBearerHeader } from "@/lib/kubeconfig-header";

const TRAILING_PERIOD_RE = /\.$/;

export interface ProjectDeleteGuardInput {
  apiBaseUrl?: string;
  encodedKubeconfig: string;
  fetchImpl?: typeof fetch;
  id: string;
  namespace: string;
}

export interface ProjectChildResourceSummary {
  ap: string[];
  db: string[];
  template: string[];
  templatePersistentVolumeClaims: string[];
}

export class ProjectDeleteBlockedError extends Error {
  readonly resources: ProjectChildResourceSummary;

  constructor(resources: ProjectChildResourceSummary) {
    const parts = [
      resources.ap.length > 0 ? `${resources.ap.length} AP` : "",
      resources.db.length > 0 ? `${resources.db.length} DB` : "",
      resources.template.length > 0
        ? `${resources.template.length} template`
        : "",
      resources.templatePersistentVolumeClaims.length > 0
        ? `${resources.templatePersistentVolumeClaims.length} template PVC`
        : "",
    ].filter(Boolean);
    super(`Project still has ${parts.join(" and ")} resource(s).`);
    this.name = "ProjectDeleteBlockedError";
    this.resources = resources;
  }
}

export class ProjectManagedResourceCleanupError extends Error {
  readonly operation: "delete" | "inspect";
  readonly status?: number;

  constructor(input: {
    message: string;
    operation: ProjectManagedResourceCleanupError["operation"];
    status?: number;
  }) {
    super(input.message);
    this.name = "ProjectManagedResourceCleanupError";
    this.operation = input.operation;
    this.status = input.status;
  }
}

function apiUrl(baseUrl: string, path: string, params: URLSearchParams): URL {
  const base = baseUrl.trim();
  if (base === "") {
    throw new ProjectManagedResourceCleanupError({
      message: "API_URL is required to clean up project resources.",
      operation: "inspect",
    });
  }
  const url = new URL(path, base);
  url.search = params.toString();
  return url;
}

async function responseErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  const body = await response.json().catch(() => null);
  if (body != null && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string" && error.trim() !== "") {
      return `${fallback.replace(TRAILING_PERIOD_RE, "")}: ${error.trim()}`;
    }
  }
  return fallback;
}

function resourceNames(payload: unknown): string[] {
  const items =
    payload != null &&
    typeof payload === "object" &&
    Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : [];
  return items
    .map((item) => {
      const metadata =
        item != null && typeof item === "object"
          ? (item as { metadata?: unknown }).metadata
          : null;
      if (metadata == null || typeof metadata !== "object") {
        return "";
      }
      const name = (metadata as { name?: unknown }).name;
      return typeof name === "string" ? name.trim() : "";
    })
    .filter((name) => name !== "");
}

async function listProjectResources(
  input: ProjectDeleteGuardInput,
  path: string,
  extraParams?: Record<string, string>
): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    "label-selector": `${BRAIN_PROJECT_ID_LABEL}=${input.id}`,
    namespace: input.namespace,
    ...extraParams,
  });
  const response = await fetchImpl(
    apiUrl(input.apiBaseUrl ?? process.env.API_URL ?? "", path, params),
    {
      cache: "no-store",
      headers: {
        Authorization: kubeconfigBearerHeader(input.encodedKubeconfig),
      },
    }
  );
  if (!response.ok) {
    throw new ProjectManagedResourceCleanupError({
      message: await responseErrorMessage(
        response,
        `Failed to inspect project resources (${response.status}).`
      ),
      operation: "inspect",
      status: response.status,
    });
  }
  return resourceNames(await response.json());
}

function listProjectK8sResources(
  input: ProjectDeleteGuardInput,
  kind: string,
  labelSelector: string
): Promise<string[]> {
  return listProjectResources(input, API_ROUTES.k8s.get, {
    kind,
    "label-selector": labelSelector,
  });
}

async function deleteProjectResource(
  input: ProjectDeleteGuardInput,
  path: string,
  name: string
): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    name,
    namespace: input.namespace,
  });
  const response = await fetchImpl(
    apiUrl(input.apiBaseUrl ?? process.env.API_URL ?? "", path, params),
    {
      cache: "no-store",
      headers: {
        Authorization: kubeconfigBearerHeader(input.encodedKubeconfig),
      },
      method: "DELETE",
    }
  );
  if (!response.ok) {
    if (response.status === 404) {
      return;
    }
    throw new ProjectManagedResourceCleanupError({
      message: await responseErrorMessage(
        response,
        `Failed to delete project resource ${name} (${response.status}).`
      ),
      operation: "delete",
      status: response.status,
    });
  }
}

async function deleteProjectK8sResource(
  input: ProjectDeleteGuardInput,
  kind: string,
  name: string
): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    kind,
    name,
    namespace: input.namespace,
  });
  const response = await fetchImpl(
    apiUrl(
      input.apiBaseUrl ?? process.env.API_URL ?? "",
      API_ROUTES.k8s.delete,
      params
    ),
    {
      cache: "no-store",
      headers: {
        Authorization: kubeconfigBearerHeader(input.encodedKubeconfig),
      },
      method: "DELETE",
    }
  );
  if (!response.ok) {
    if (response.status === 404) {
      return;
    }
    throw new ProjectManagedResourceCleanupError({
      message: await responseErrorMessage(
        response,
        `Failed to delete project resource ${name} (${response.status}).`
      ),
      operation: "delete",
      status: response.status,
    });
  }
}

async function deleteProjectK8sResourcesBySelector(
  input: ProjectDeleteGuardInput,
  kind: string,
  labelSelector: string
): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    kind,
    "label-selector": labelSelector,
    namespace: input.namespace,
  });
  const response = await fetchImpl(
    apiUrl(
      input.apiBaseUrl ?? process.env.API_URL ?? "",
      API_ROUTES.k8s.delete,
      params
    ),
    {
      cache: "no-store",
      headers: {
        Authorization: kubeconfigBearerHeader(input.encodedKubeconfig),
      },
      method: "DELETE",
    }
  );
  if (!response.ok) {
    if (response.status === 404) {
      return;
    }
    throw new ProjectManagedResourceCleanupError({
      message: await responseErrorMessage(
        response,
        `Failed to delete project resources (${kind}, ${response.status}).`
      ),
      operation: "delete",
      status: response.status,
    });
  }
}

function projectLabelSelector(projectId: string): string {
  return `${BRAIN_PROJECT_ID_LABEL}=${projectId}`;
}

function templateProjectLabelSelector(projectId: string): string {
  return `${projectLabelSelector(projectId)},${BRAIN_DEPLOYMENT_KIND_LABEL}=template`;
}

export async function assertProjectHasNoManagedResources(
  input: ProjectDeleteGuardInput
): Promise<void> {
  const templateSelector = templateProjectLabelSelector(input.id);
  const [ap, db, template, templatePersistentVolumeClaims] = await Promise.all([
    listProjectResources(input, API_ROUTES.ap.root),
    listProjectResources(input, API_ROUTES.db.root),
    listProjectK8sResources(input, "instances", templateSelector),
    listProjectK8sResources(input, "persistentvolumeclaims", templateSelector),
  ]);
  const resources = { ap, db, template, templatePersistentVolumeClaims };
  if (
    resources.ap.length > 0 ||
    resources.db.length > 0 ||
    resources.template.length > 0 ||
    resources.templatePersistentVolumeClaims.length > 0
  ) {
    throw new ProjectDeleteBlockedError(resources);
  }
}

export async function deleteProjectManagedResources(
  input: ProjectDeleteGuardInput
): Promise<ProjectChildResourceSummary> {
  const templateSelector = templateProjectLabelSelector(input.id);
  const [ap, db, template, templatePersistentVolumeClaims] = await Promise.all([
    listProjectResources(input, API_ROUTES.ap.root),
    listProjectResources(input, API_ROUTES.db.root),
    listProjectK8sResources(input, "instances", templateSelector),
    listProjectK8sResources(input, "persistentvolumeclaims", templateSelector),
  ]);
  for (const name of db) {
    await deleteProjectResource(input, API_ROUTES.db.root, name);
  }
  for (const name of ap) {
    await deleteProjectResource(input, API_ROUTES.ap.root, name);
  }
  if (templatePersistentVolumeClaims.length > 0) {
    await deleteProjectK8sResourcesBySelector(
      input,
      "persistentvolumeclaims",
      templateSelector
    );
  }
  for (const name of template) {
    await deleteProjectK8sResource(input, "instances", name);
  }
  return { ap, db, template, templatePersistentVolumeClaims };
}
