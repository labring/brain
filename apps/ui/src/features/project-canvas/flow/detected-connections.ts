import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { Edge, Node } from "@xyflow/react";
import {
  type ApEnvironmentDbReferenceSource,
  dbDsnReferenceSourceFromDb,
} from "@/features/project-settings/ap/k8s/db-dsn-reference-sources";
import { resolveApEnvRawSourceReferences } from "@/features/project-settings/ap/lib/ap-env-raw-source";
import {
  type ApEnvDbDsnSource,
  apEnvDbDsnReferenceFromValue,
  apEnvDbSecretReferenceFromValueFrom,
} from "@/features/project-settings/ap/lib/ap-env-rows";
import {
  canvasResourceIdentityFromNode,
  canvasResourceKey,
} from "../nodes/resource-identity";
import { isPlatformAddressId } from "../platform-addresses";

export type CanvasDetectedConnectionKind = "PublicAccessToAP" | "APToDB";
export type CanvasConnectionResourceKind = "AP" | "DB" | "PublicAccess";

export interface CanvasConnectionResourceRef {
  kind: CanvasConnectionResourceKind;
  name: string;
  namespace: string;
}

export interface CanvasDetectedConnection {
  kind: CanvasDetectedConnectionKind;
  source: CanvasConnectionResourceRef;
  target: CanvasConnectionResourceRef;
}

export interface DetectCanvasConnectionsOptions {
  apEnvironmentDbReferenceSources?: readonly ApEnvironmentDbReferenceSource[];
  apsData: K8sGetResponse | undefined;
  dbsData: K8sGetResponse | undefined;
  namespaceFallback?: string;
}

export interface DetectedCanvasConnectionEdgesOptions
  extends DetectCanvasConnectionsOptions {
  nodes: Node[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object"
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

export function canvasConnectionResourceKey(
  ref: CanvasConnectionResourceRef
): string {
  return canvasResourceKey(ref);
}

function connectionKey(connection: CanvasDetectedConnection): string {
  const sourceKey = canvasConnectionResourceKey(connection.source);
  const targetKey = canvasConnectionResourceKey(connection.target);
  return `${sourceKey}->${targetKey}`;
}

function resourceRef(
  kind: CanvasConnectionResourceKind,
  name: string | undefined,
  namespace: string | undefined
): CanvasConnectionResourceRef | undefined {
  if (name === undefined || namespace === undefined) {
    return undefined;
  }
  return { kind, name, namespace };
}

function resourceRefFromMetadata(
  kind: CanvasConnectionResourceKind,
  resource: unknown,
  namespaceFallback: string | undefined
): CanvasConnectionResourceRef | undefined {
  return resourceRef(
    kind,
    metadataName(resource),
    metadataNamespace(resource, namespaceFallback)
  );
}

export function canvasConnectionNodeResourceRef(
  node: Node
): CanvasConnectionResourceRef | undefined {
  return canvasResourceIdentityFromNode(node);
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

function addUniqueConnection(
  connections: CanvasDetectedConnection[],
  seenConnectionKeys: Set<string>,
  connection: CanvasDetectedConnection
): void {
  const key = connectionKey(connection);
  if (seenConnectionKeys.has(key)) {
    return;
  }
  seenConnectionKeys.add(key);
  connections.push(connection);
}

function addNetworkPublicAddressConnections(
  connections: CanvasDetectedConnection[],
  seenConnectionKeys: Set<string>,
  aps: readonly unknown[],
  namespaceFallback: string | undefined
): void {
  for (const ap of aps) {
    if (!apHasNetworkPublicAddresses(ap)) {
      continue;
    }
    const target = resourceRefFromMetadata("AP", ap, namespaceFallback);
    if (target === undefined) {
      continue;
    }
    const source = resourceRef("PublicAccess", target.name, target.namespace);
    if (source === undefined) {
      continue;
    }
    addUniqueConnection(connections, seenConnectionKeys, {
      kind: "PublicAccessToAP",
      source,
      target,
    });
  }
}

function dbDsnReferenceSourcesFromDbs(
  dbs: readonly unknown[],
  namespaceFallback: string | undefined
): ApEnvironmentDbReferenceSource[] {
  const dbDsnSources: ApEnvironmentDbReferenceSource[] = [];
  for (const db of dbs) {
    const dsnSource = dbDsnReferenceSourceFromDb(db, namespaceFallback);
    if (dsnSource !== undefined) {
      dbDsnSources.push(dsnSource);
    }
  }
  return dbDsnSources;
}

function addSecretBackedApDbConnections(
  connections: CanvasDetectedConnection[],
  seenConnectionKeys: Set<string>,
  source: CanvasConnectionResourceRef,
  dbDsnSources: readonly ApEnvDbDsnSource[],
  ap: unknown
): void {
  for (const valueFrom of valueFromRefsFromAp(ap)) {
    const reference = apEnvDbSecretReferenceFromValueFrom(
      valueFrom,
      dbDsnSources
    );
    const target = resourceRef(
      "DB",
      reference?.dbDsn?.dbName,
      reference?.dbDsn?.dbNamespace
    );
    if (target !== undefined) {
      addUniqueConnection(connections, seenConnectionKeys, {
        kind: "APToDB",
        source,
        target,
      });
    }
  }
}

function addDsnBackedApDbConnections(
  connections: CanvasDetectedConnection[],
  seenConnectionKeys: Set<string>,
  source: CanvasConnectionResourceRef,
  dbDsnSources: readonly ApEnvDbDsnSource[],
  ap: unknown
): void {
  for (const envValue of envValuesFromAp(ap)) {
    const reference = apEnvDbDsnReferenceFromValue(envValue, dbDsnSources);
    const target = resourceRef(
      "DB",
      reference?.dbDsn?.dbName,
      reference?.dbDsn?.dbNamespace
    );
    if (target !== undefined) {
      addUniqueConnection(connections, seenConnectionKeys, {
        kind: "APToDB",
        source,
        target,
      });
    }
  }
}

function addRawSourceApDbConnections(
  connections: CanvasDetectedConnection[],
  seenConnectionKeys: Set<string>,
  source: CanvasConnectionResourceRef,
  dbDsnSources: readonly ApEnvDbDsnSource[],
  ap: unknown
): void {
  const rawSource = envRawSourceFromAp(ap);
  if (rawSource === undefined) {
    return;
  }
  const resolved = resolveApEnvRawSourceReferences(rawSource, dbDsnSources);
  for (const reference of resolved.references) {
    const target = resourceRef(
      "DB",
      reference.canonicalDbName,
      reference.source.namespace
    );
    if (target !== undefined) {
      addUniqueConnection(connections, seenConnectionKeys, {
        kind: "APToDB",
        source,
        target,
      });
    }
  }
}

function addApDbConnections(
  connections: CanvasDetectedConnection[],
  seenConnectionKeys: Set<string>,
  aps: readonly unknown[],
  dbDsnSources: readonly ApEnvDbDsnSource[],
  namespaceFallback: string | undefined
): void {
  for (const ap of aps) {
    const source = resourceRefFromMetadata("AP", ap, namespaceFallback);
    if (source === undefined) {
      continue;
    }
    addRawSourceApDbConnections(
      connections,
      seenConnectionKeys,
      source,
      dbDsnSources,
      ap
    );
    addSecretBackedApDbConnections(
      connections,
      seenConnectionKeys,
      source,
      dbDsnSources,
      ap
    );
    addDsnBackedApDbConnections(
      connections,
      seenConnectionKeys,
      source,
      dbDsnSources,
      ap
    );
  }
}

export function detectCanvasConnections({
  apEnvironmentDbReferenceSources,
  apsData,
  dbsData,
  namespaceFallback,
}: DetectCanvasConnectionsOptions): CanvasDetectedConnection[] {
  const aps = apItemsFromList(apsData);
  const dbs = apItemsFromList(dbsData);
  const dbReferenceSources =
    apEnvironmentDbReferenceSources ??
    dbDsnReferenceSourcesFromDbs(dbs, namespaceFallback);
  const connections: CanvasDetectedConnection[] = [];
  const seenConnectionKeys = new Set<string>();
  addNetworkPublicAddressConnections(
    connections,
    seenConnectionKeys,
    aps,
    namespaceFallback
  );
  addApDbConnections(
    connections,
    seenConnectionKeys,
    aps,
    dbReferenceSources,
    namespaceFallback
  );

  return connections;
}

export function canvasConnectionEdgesFromDetectedConnections(
  connections: readonly CanvasDetectedConnection[],
  nodes: readonly Node[]
): Edge[] {
  const nodeIdByResourceKey = new Map<string, string>();
  for (const node of nodes) {
    const ref = canvasConnectionNodeResourceRef(node);
    if (ref !== undefined) {
      nodeIdByResourceKey.set(canvasConnectionResourceKey(ref), node.id);
    }
  }

  const edges: Edge[] = [];
  const seenEdgeIds = new Set<string>();
  for (const connection of connections) {
    const sourceKey = canvasConnectionResourceKey(connection.source);
    const targetKey = canvasConnectionResourceKey(connection.target);
    const source = nodeIdByResourceKey.get(sourceKey);
    const target = nodeIdByResourceKey.get(targetKey);
    if (source === undefined || target === undefined) {
      continue;
    }
    const id = `detected:${sourceKey}->${targetKey}`;
    if (seenEdgeIds.has(id)) {
      continue;
    }
    seenEdgeIds.add(id);
    edges.push({
      id,
      source,
      target,
    });
  }
  return edges;
}

export function detectedCanvasConnectionEdges({
  nodes,
  ...options
}: DetectedCanvasConnectionEdgesOptions): Edge[] {
  return canvasConnectionEdgesFromDetectedConnections(
    detectCanvasConnections(options),
    nodes
  );
}
