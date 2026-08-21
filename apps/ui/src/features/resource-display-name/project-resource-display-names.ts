import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { ApiUrl } from "@workspace/api/utils";
import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import {
  resolveApDisplayName,
  resolveDbDisplayName,
} from "./resource-display-name";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function metadataRecord(resource: unknown): Record<string, unknown> {
  return asRecord(asRecord(resource)?.metadata) ?? {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function apDisplayNameFromResource(ap: unknown): string | undefined {
  const metadata = metadataRecord(ap);
  const name = stringValue(metadata.name);
  if (name === undefined) {
    return undefined;
  }
  const input = asRecord(asRecord(asRecord(ap)?.spec)?.input);
  return resolveApDisplayName({
    annotations: asRecord(metadata.annotations),
    image: stringValue(input?.image),
    kubernetesName: name,
    labels: asRecord(metadata.labels),
  });
}

export function dbDisplayNameFromResource(db: unknown): string | undefined {
  const metadata = metadataRecord(db);
  const name = stringValue(metadata.name);
  if (name === undefined) {
    return undefined;
  }
  return resolveDbDisplayName({
    annotations: asRecord(metadata.annotations),
    engine: stringValue(asRecord(asRecord(db)?.spec)?.engine),
    kubernetesName: name,
    labels: asRecord(metadata.labels),
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
  return apItemsFromList(data);
}

/**
 * Display names currently taken in the Project, resolved through the full
 * chain so an unannotated legacy `nginx` still blocks a second bare `nginx`.
 * Used by deploy-time numbering (ADR 0062).
 */
export async function projectResourceDisplayNames(input: {
  kubeconfig: string;
  namespace: string;
  projectId: string;
}): Promise<string[]> {
  const [aps, dbs] = await Promise.all([
    projectResourceList({ ...input, path: API_ROUTES.ap.root }),
    projectResourceList({ ...input, path: API_ROUTES.db.root }),
  ]);
  return [
    ...aps.map(apDisplayNameFromResource),
    ...dbs.map(dbDisplayNameFromResource),
  ].filter((name): name is string => name !== undefined);
}
