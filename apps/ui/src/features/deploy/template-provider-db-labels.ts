import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import {
  BRAIN_DB_ENGINE_LABEL,
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_DEPLOYMENT_NAME_LABEL,
  BRAIN_MANAGED_BY_LABEL,
  BRAIN_MANAGED_BY_VALUE,
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_TEMPLATE_NAME_LABEL,
  DB_PROVIDER_CLUSTER_DEFINITION_LABEL,
  DB_PROVIDER_CLUSTER_VERSION_LABEL,
  DB_PROVIDER_INSTANCE_LABEL,
} from "@/lib/brain-labels";

export interface TemplateProviderResourceSummary {
  name: string;
  resourceType: string;
  uid?: string;
}

const CLUSTER_RESOURCE_TYPES = new Set([
  "cluster",
  "clusters",
  "kubeblockscluster",
  "kubeblocksclusters",
]);
const DIGIT_RE = /\d/;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function metadataRecord(cluster: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(cluster)?.metadata);
}

function specRecord(cluster: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(cluster)?.spec);
}

function metadataName(cluster: unknown): string | undefined {
  return stringValue(metadataRecord(cluster)?.name);
}

function metadataLabels(cluster: unknown): Record<string, unknown> {
  return asRecord(metadataRecord(cluster)?.labels) ?? {};
}

function engineFromDefinition(
  definition: string | undefined
): string | undefined {
  switch (definition) {
    case "postgresql":
      return "postgresql";
    case "apecloud-mysql":
    case "mysql":
      return "mysql";
    case "redis":
      return "redis";
    case "mongodb":
      return "mongodb";
    default:
      return undefined;
  }
}

function definitionFromKbDatabase(
  value: string | undefined
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized.startsWith("postgresql-") || normalized === "postgresql") {
    return "postgresql";
  }
  if (normalized.startsWith("redis-") || normalized === "redis") {
    return "redis";
  }
  if (normalized.startsWith("mongodb-") || normalized === "mongodb") {
    return "mongodb";
  }
  if (normalized.startsWith("ac-mysql-") || normalized === "apecloud-mysql") {
    return "apecloud-mysql";
  }
  if (normalized.startsWith("mysql-") || normalized === "mysql") {
    return "mysql";
  }
  return undefined;
}

function versionFromKbDatabase(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return DIGIT_RE.test(value) ? value : undefined;
}

function authHeader(encodedKubeconfig: string): Record<string, string> {
  return { Authorization: `Bearer ${encodeURIComponent(encodedKubeconfig)}` };
}

async function getKubeBlocksCluster(input: {
  encodedKubeconfig: string;
  name: string;
  namespace: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  return await fetcher({
    base: ApiUrl(),
    header: authHeader(input.encodedKubeconfig),
    method: "GET",
    path: API_ROUTES.k8s.get,
    query: {
      kind: "clusters",
      name: input.name,
      namespace: input.namespace,
    },
    signal: input.signal,
  });
}

async function patchKubeBlocksClusterLabels(input: {
  encodedKubeconfig: string;
  labels: Record<string, string>;
  name: string;
  namespace: string;
  signal?: AbortSignal;
}): Promise<void> {
  if (Object.keys(input.labels).length === 0) {
    return;
  }
  await fetcher({
    base: ApiUrl(),
    body: { metadata: { labels: input.labels } },
    header: authHeader(input.encodedKubeconfig),
    method: "PATCH",
    path: API_ROUTES.k8s.patch,
    query: {
      kind: "clusters",
      name: input.name,
      namespace: input.namespace,
      type: "merge",
    },
    signal: input.signal,
  });
}

export function isTemplateProviderClusterResource(
  resource: TemplateProviderResourceSummary
): boolean {
  return (
    resource.name.trim() !== "" &&
    CLUSTER_RESOURCE_TYPES.has(resource.resourceType.trim().toLowerCase())
  );
}

export function dbLabelValuesForCluster(cluster: unknown): {
  definition?: string;
  engine?: string;
  version?: string;
} {
  const labels = metadataLabels(cluster);
  const spec = specRecord(cluster);
  const kbDatabase = stringValue(labels["kb.io/database"]);
  const definition =
    stringValue(labels[DB_PROVIDER_CLUSTER_DEFINITION_LABEL]) ??
    stringValue(spec?.clusterDefinitionRef) ??
    definitionFromKbDatabase(kbDatabase);
  const version =
    stringValue(labels[DB_PROVIDER_CLUSTER_VERSION_LABEL]) ??
    stringValue(spec?.clusterVersionRef) ??
    versionFromKbDatabase(kbDatabase);
  const engine = engineFromDefinition(definition);
  return {
    ...(definition === undefined ? {} : { definition }),
    ...(engine === undefined ? {} : { engine }),
    ...(version === undefined ? {} : { version }),
  };
}

export function templateProviderDbLabels(input: {
  cluster: unknown;
  instanceName: string;
  projectId: string;
  templateName: string;
}): Record<string, string> {
  const values = dbLabelValuesForCluster(input.cluster);
  const name = metadataName(input.cluster);
  if (name === undefined || values.definition === undefined) {
    return {};
  }
  return {
    [DB_PROVIDER_INSTANCE_LABEL]: name,
    [BRAIN_MANAGED_BY_LABEL]: BRAIN_MANAGED_BY_VALUE,
    [BRAIN_PROJECT_ID_LABEL]: input.projectId,
    [BRAIN_DEPLOYMENT_KIND_LABEL]: "template",
    [BRAIN_DEPLOYMENT_NAME_LABEL]: input.instanceName,
    [BRAIN_TEMPLATE_NAME_LABEL]: input.templateName,
    ...(values.engine === undefined
      ? {}
      : { [BRAIN_DB_ENGINE_LABEL]: values.engine }),
    [DB_PROVIDER_CLUSTER_DEFINITION_LABEL]: values.definition,
    ...(values.version === undefined
      ? {}
      : { [DB_PROVIDER_CLUSTER_VERSION_LABEL]: values.version }),
  };
}

export interface TemplateProviderDbResourceSummary {
  engine?: string;
  name: string;
}

export async function normalizeTemplateProviderDbResources(input: {
  encodedKubeconfig: string;
  instanceName: string;
  namespace: string;
  projectId: string;
  resources: TemplateProviderResourceSummary[];
  signal?: AbortSignal;
  templateName: string;
}): Promise<TemplateProviderDbResourceSummary[]> {
  const normalized: TemplateProviderDbResourceSummary[] = [];
  for (const resource of input.resources) {
    if (!isTemplateProviderClusterResource(resource)) {
      continue;
    }
    const name = resource.name.trim();
    const cluster = await getKubeBlocksCluster({
      encodedKubeconfig: input.encodedKubeconfig,
      name,
      namespace: input.namespace,
      signal: input.signal,
    });
    const labels = templateProviderDbLabels({
      cluster,
      instanceName: input.instanceName,
      projectId: input.projectId,
      templateName: input.templateName,
    });
    await patchKubeBlocksClusterLabels({
      encodedKubeconfig: input.encodedKubeconfig,
      labels,
      name,
      namespace: input.namespace,
      signal: input.signal,
    });
    const engine = labels[BRAIN_DB_ENGINE_LABEL];
    normalized.push({ ...(engine === undefined ? {} : { engine }), name });
  }
  return normalized;
}
