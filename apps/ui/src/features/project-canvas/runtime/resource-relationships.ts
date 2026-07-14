import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import { isPlatformAddressId } from "@/features/project-canvas/platform-addresses";
import type { ApEnvironmentDbReferenceSource } from "@/features/resource-settings/ap/k8s/db-dsn-reference-sources";
import { dbDsnReferenceSourceFromDb } from "@/features/resource-settings/ap/k8s/db-dsn-reference-sources";
import { resolveApEnvRawSourceReferences } from "@/features/resource-settings/ap/lib/ap-env-raw-source";
import {
  type ApEnvDbDsnSource,
  apEnvDbDsnReferenceFromValue,
  apEnvDbSecretReferenceFromValueFrom,
} from "@/features/resource-settings/ap/lib/ap-env-rows";

export interface ProjectRuntimeApDbRelationship {
  kind: "APToDB";
  source: CanvasLayoutResourceRef & { kind: "AP" };
  target: CanvasLayoutResourceRef & { kind: "DB" };
}

export interface ProjectRuntimePublicAccessRelationship {
  kind: "PublicAccessToAP";
  source: CanvasLayoutResourceRef & { kind: "PublicAccess" };
  target: CanvasLayoutResourceRef & { kind: "AP" };
}

export interface ProjectRuntimeRelationshipIndexes {
  apEnvironmentDbReferenceSources: ApEnvironmentDbReferenceSource[];
  apToDb: ProjectRuntimeApDbRelationship[];
  publicAccessToAp: ProjectRuntimePublicAccessRelationship[];
}

export interface ProjectRuntimeRelationshipIndexesInput {
  apsData?: K8sGetResponse;
  dbsData?: K8sGetResponse;
  namespaceFallback?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function metadataRecord(
  resource: unknown
): Record<string, unknown> | undefined {
  return asRecord(asRecord(resource)?.metadata);
}

function metadataName(resource: unknown): string | undefined {
  return nonEmptyString(metadataRecord(resource)?.name);
}

function metadataNamespace(
  resource: unknown,
  fallback: string | undefined
): string | undefined {
  return (
    nonEmptyString(metadataRecord(resource)?.namespace) ??
    nonEmptyString(fallback)
  );
}

function specRecord(resource: unknown): Record<string, unknown> | undefined {
  return asRecord(asRecord(resource)?.spec);
}

function hasPublicAddressesFromNetwork(network: unknown): boolean {
  const record = asRecord(network);
  const publicAddresses = record?.publicAddresses;
  if (Array.isArray(publicAddresses) && publicAddresses.length > 0) {
    return true;
  }
  const platformAddresses = record?.platformAddresses;
  return (
    Array.isArray(platformAddresses) &&
    platformAddresses.some((address) =>
      isPlatformAddressId(asRecord(address)?.id)
    )
  );
}

function apHasNetworkPublicAddresses(ap: unknown): boolean {
  const spec = specRecord(ap);
  const inputNetwork = asRecord(asRecord(spec?.input)?.network);
  const statusNetwork = asRecord(asRecord(ap)?.status)?.network;
  return (
    hasPublicAddressesFromNetwork(statusNetwork) ||
    hasPublicAddressesFromNetwork(inputNetwork)
  );
}

function apRefFromResource(
  ap: unknown,
  namespaceFallback: string | undefined
): (CanvasLayoutResourceRef & { kind: "AP" }) | undefined {
  const name = metadataName(ap);
  const namespace = metadataNamespace(ap, namespaceFallback);
  if (name === undefined || namespace === undefined) {
    return undefined;
  }
  return { kind: "AP", name, namespace };
}

function dbRefFromReference(input: {
  name: string | undefined;
  namespace: string | undefined;
}): (CanvasLayoutResourceRef & { kind: "DB" }) | undefined {
  if (input.name === undefined || input.namespace === undefined) {
    return undefined;
  }
  return { kind: "DB", name: input.name, namespace: input.namespace };
}

function envItemsFromAp(ap: unknown): unknown[] {
  const spec = specRecord(ap);
  const input = asRecord(spec?.input);
  if (Array.isArray(input?.env)) {
    return input.env;
  }
  const env = spec?.env;
  return Array.isArray(env) ? env : [];
}

function valueFromRefsFromAp(ap: unknown): unknown[] {
  const refs: unknown[] = [];
  for (const item of envItemsFromAp(ap)) {
    const envItem = asRecord(item);
    if (envItem?.valueFrom !== undefined) {
      refs.push(envItem.valueFrom);
    }
  }
  return refs;
}

function envValuesFromAp(ap: unknown): string[] {
  const values: string[] = [];
  for (const item of envItemsFromAp(ap)) {
    const envItem = asRecord(item);
    if (typeof envItem?.value === "string") {
      values.push(envItem.value);
    }
  }
  return values;
}

function envRawSourceFromAp(ap: unknown): string | undefined {
  const spec = specRecord(ap);
  const input = asRecord(spec?.input);
  return typeof input?.envRawSource === "string"
    ? input.envRawSource
    : undefined;
}

function relationshipKey(relationship: ProjectRuntimeApDbRelationship): string {
  return `${relationship.source.kind}:${relationship.source.namespace}:${relationship.source.name}->${relationship.target.kind}:${relationship.target.namespace}:${relationship.target.name}`;
}

function addUniqueApDbRelationship(
  relationships: ProjectRuntimeApDbRelationship[],
  seenKeys: Set<string>,
  relationship: ProjectRuntimeApDbRelationship
): void {
  const key = relationshipKey(relationship);
  if (seenKeys.has(key)) {
    return;
  }
  seenKeys.add(key);
  relationships.push(relationship);
}

function addApDbRelationshipFromReference(
  relationships: ProjectRuntimeApDbRelationship[],
  seenKeys: Set<string>,
  source: CanvasLayoutResourceRef & { kind: "AP" },
  reference: { dbDsn?: { dbName: string; dbNamespace: string } } | undefined
): void {
  const target = dbRefFromReference({
    name: reference?.dbDsn?.dbName,
    namespace: reference?.dbDsn?.dbNamespace,
  });
  if (target === undefined) {
    return;
  }
  addUniqueApDbRelationship(relationships, seenKeys, {
    kind: "APToDB",
    source,
    target,
  });
}

function addRawSourceApDbRelationships(
  relationships: ProjectRuntimeApDbRelationship[],
  seenKeys: Set<string>,
  source: CanvasLayoutResourceRef & { kind: "AP" },
  dbReferenceSources: readonly ApEnvDbDsnSource[],
  ap: unknown
): void {
  const rawSource = envRawSourceFromAp(ap);
  if (rawSource === undefined) {
    return;
  }
  const resolved = resolveApEnvRawSourceReferences(
    rawSource,
    dbReferenceSources
  );
  for (const reference of resolved.references) {
    const target = dbRefFromReference({
      name: reference.canonicalDbName,
      namespace: reference.source.namespace,
    });
    if (target === undefined) {
      continue;
    }
    addUniqueApDbRelationship(relationships, seenKeys, {
      kind: "APToDB",
      source,
      target,
    });
  }
}

function addSecretBackedApDbRelationships(
  relationships: ProjectRuntimeApDbRelationship[],
  seenKeys: Set<string>,
  source: CanvasLayoutResourceRef & { kind: "AP" },
  dbReferenceSources: readonly ApEnvDbDsnSource[],
  ap: unknown
): void {
  for (const valueFrom of valueFromRefsFromAp(ap)) {
    addApDbRelationshipFromReference(
      relationships,
      seenKeys,
      source,
      apEnvDbSecretReferenceFromValueFrom(valueFrom, dbReferenceSources)
    );
  }
}

function addDsnBackedApDbRelationships(
  relationships: ProjectRuntimeApDbRelationship[],
  seenKeys: Set<string>,
  source: CanvasLayoutResourceRef & { kind: "AP" },
  dbReferenceSources: readonly ApEnvDbDsnSource[],
  ap: unknown
): void {
  for (const envValue of envValuesFromAp(ap)) {
    addApDbRelationshipFromReference(
      relationships,
      seenKeys,
      source,
      apEnvDbDsnReferenceFromValue(envValue, dbReferenceSources)
    );
  }
}

function apToDbRelationshipsFromResources({
  aps,
  dbReferenceSources,
  namespaceFallback,
}: {
  aps: readonly unknown[];
  dbReferenceSources: readonly ApEnvDbDsnSource[];
  namespaceFallback?: string;
}): ProjectRuntimeApDbRelationship[] {
  const relationships: ProjectRuntimeApDbRelationship[] = [];
  const seenKeys = new Set<string>();
  for (const ap of aps) {
    const source = apRefFromResource(ap, namespaceFallback);
    if (source === undefined) {
      continue;
    }
    addRawSourceApDbRelationships(
      relationships,
      seenKeys,
      source,
      dbReferenceSources,
      ap
    );
    addSecretBackedApDbRelationships(
      relationships,
      seenKeys,
      source,
      dbReferenceSources,
      ap
    );
    addDsnBackedApDbRelationships(
      relationships,
      seenKeys,
      source,
      dbReferenceSources,
      ap
    );
  }
  return relationships;
}

function publicAccessToApRelationshipsFromResources({
  aps,
  namespaceFallback,
}: {
  aps: readonly unknown[];
  namespaceFallback?: string;
}): ProjectRuntimePublicAccessRelationship[] {
  const relationships: ProjectRuntimePublicAccessRelationship[] = [];
  for (const ap of aps) {
    if (!apHasNetworkPublicAddresses(ap)) {
      continue;
    }
    const target = apRefFromResource(ap, namespaceFallback);
    if (target === undefined) {
      continue;
    }
    relationships.push({
      kind: "PublicAccessToAP",
      source: {
        kind: "PublicAccess",
        name: target.name,
        namespace: target.namespace,
      },
      target,
    });
  }
  return relationships;
}

function dbReferenceSourcesFromResources(
  dbs: readonly unknown[],
  namespaceFallback: string | undefined
): ApEnvironmentDbReferenceSource[] {
  return dbs
    .map((db) => dbDsnReferenceSourceFromDb(db, namespaceFallback))
    .filter(
      (source): source is ApEnvironmentDbReferenceSource => source !== undefined
    );
}

export function projectRuntimeRelationshipIndexesFromResources({
  apsData,
  dbsData,
  namespaceFallback,
}: ProjectRuntimeRelationshipIndexesInput): ProjectRuntimeRelationshipIndexes {
  const aps = apItemsFromList(apsData);
  const dbs = apItemsFromList(dbsData);
  const apEnvironmentDbReferenceSources = dbReferenceSourcesFromResources(
    dbs,
    namespaceFallback
  );
  return {
    apEnvironmentDbReferenceSources,
    apToDb: apToDbRelationshipsFromResources({
      aps,
      dbReferenceSources: apEnvironmentDbReferenceSources,
      namespaceFallback,
    }),
    publicAccessToAp: publicAccessToApRelationshipsFromResources({
      aps,
      namespaceFallback,
    }),
  };
}
