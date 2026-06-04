import { API_ROUTES } from "@workspace/api/constants";

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
}

export class ProjectDeleteBlockedError extends Error {
  readonly resources: ProjectChildResourceSummary;

  constructor(resources: ProjectChildResourceSummary) {
    const parts = [
      resources.ap.length > 0 ? `${resources.ap.length} AP` : "",
      resources.db.length > 0 ? `${resources.db.length} DB` : "",
    ].filter(Boolean);
    super(`Project still has ${parts.join(" and ")} resource(s).`);
    this.name = "ProjectDeleteBlockedError";
    this.resources = resources;
  }
}

function apiUrl(baseUrl: string, path: string, params: URLSearchParams): URL {
  const base = baseUrl.trim() || "http://localhost:3000";
  const url = new URL(path, base);
  url.search = params.toString();
  return url;
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
  path: string
): Promise<string[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const params = new URLSearchParams({
    "label-selector": `brain.io/project-id=${input.id}`,
    namespace: input.namespace,
  });
  const response = await fetchImpl(
    apiUrl(input.apiBaseUrl ?? process.env.API_URL ?? "", path, params),
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${encodeURIComponent(input.encodedKubeconfig.trim())}`,
      },
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to inspect project resources (${response.status}).`
    );
  }
  return resourceNames(await response.json());
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
        Authorization: `Bearer ${encodeURIComponent(input.encodedKubeconfig.trim())}`,
      },
      method: "DELETE",
    }
  );
  if (!response.ok) {
    if (response.status === 404) {
      return;
    }
    throw new Error(
      `Failed to delete project resource ${name} (${response.status}).`
    );
  }
}

export async function assertProjectHasNoManagedResources(
  input: ProjectDeleteGuardInput
): Promise<void> {
  const [ap, db] = await Promise.all([
    listProjectResources(input, API_ROUTES.ap.root),
    listProjectResources(input, API_ROUTES.db.root),
  ]);
  if (ap.length > 0 || db.length > 0) {
    throw new ProjectDeleteBlockedError({ ap, db });
  }
}

export async function deleteProjectManagedResources(
  input: ProjectDeleteGuardInput
): Promise<ProjectChildResourceSummary> {
  const [ap, db] = await Promise.all([
    listProjectResources(input, API_ROUTES.ap.root),
    listProjectResources(input, API_ROUTES.db.root),
  ]);
  for (const name of db) {
    await deleteProjectResource(input, API_ROUTES.db.root, name);
  }
  for (const name of ap) {
    await deleteProjectResource(input, API_ROUTES.ap.root, name);
  }
  return { ap, db };
}
