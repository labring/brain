import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
// Generic k8s list unwrapping despite the module name; used for DBs too.
import { apItemsFromList as k8sItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { ApiUrl } from "@workspace/api/utils";
import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import { asRecord } from "@/lib/unknown-record";
import { resolveResourceDisplayName } from "./resource-display-name";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function kubernetesNameFromResource(resource: unknown): string | undefined {
  return stringValue(asRecord(asRecord(resource)?.metadata)?.name);
}

export function resourceDisplayNameFromResource(
  resource: unknown
): string | undefined {
  const metadata = asRecord(asRecord(resource)?.metadata) ?? {};
  const name = stringValue(metadata.name);
  if (name === undefined) {
    return undefined;
  }
  return resolveResourceDisplayName({
    annotations: asRecord(metadata.annotations),
    kubernetesName: name,
  });
}

async function projectResourceList(input: {
  kubeconfig: string;
  namespace: string;
  path: string;
  projectId: string;
}): Promise<unknown[]> {
  const data = await fetcher<K8sGetResponse>({
    base: ApiUrl(),
    header: {
      Authorization: `Bearer ${encodeURIComponent(input.kubeconfig.trim())}`,
    },
    method: "GET",
    path: input.path,
    query: {
      "label-selector": `${BRAIN_PROJECT_ID_LABEL}=${input.projectId}`,
      namespace: input.namespace,
    },
  });
  return k8sItemsFromList(data);
}

/**
 * Display names currently taken in the Project — the annotation where one is
 * set, the Kubernetes name otherwise. Used by deploy-time numbering
 * (ADR 0066). `excludeKubernetesNames` drops resources by identity — the
 * post-create template path names resources that already exist, which must
 * not count as taken against themselves.
 */
export async function projectResourceDisplayNames(input: {
  excludeKubernetesNames?: Iterable<string>;
  kubeconfig: string;
  namespace: string;
  projectId: string;
}): Promise<string[]> {
  const excluded = new Set(
    [...(input.excludeKubernetesNames ?? [])].map((name) =>
      name.trim().toLowerCase()
    )
  );
  const [aps, dbs] = await Promise.all([
    projectResourceList({ ...input, path: API_ROUTES.ap.root }),
    projectResourceList({ ...input, path: API_ROUTES.db.root }),
  ]);
  return [...aps, ...dbs]
    .filter((resource) => {
      const name = kubernetesNameFromResource(resource);
      return name === undefined || !excluded.has(name.trim().toLowerCase());
    })
    .map(resourceDisplayNameFromResource)
    .filter((name): name is string => name !== undefined);
}
