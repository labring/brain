import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import {
  platformAddressIdFromValue,
  platformAddressIdsFromRows,
} from "@/features/project-canvas/platform-addresses";
import {
  readApImage,
  readApIsPaused,
  readApReplicas,
} from "@/features/project-settings/ap/k8s/ap-spec-access";
import {
  type ProjectRuntimeRelationshipIndexes,
  projectRuntimeRelationshipIndexesFromResources,
} from "./resource-relationships";

export type ProjectRuntimeResourceKind = "AP" | "DB" | "PublicAccess";

export type ProjectRuntimeFactKey = string;

export interface ProjectRuntimeStatusSummary {
  label: string;
  tone?: string;
}

export interface ApFact {
  displayName: string;
  key: ProjectRuntimeFactKey;
  observedUid?: string;
  ref: CanvasLayoutResourceRef & { kind: "AP" };
  replicaSummary?: {
    /** Desired replica count from the AP replica strategy. */
    desired?: number;
    /** Ready pods currently serving, from workload status. */
    ready?: number;
  };
  status: ProjectRuntimeStatusSummary;
  workload: {
    image: string;
    kind: "AP";
  };
}

export interface DbFact {
  capacitySummary?: {
    cpu?: string;
    memory?: string;
    storage?: string;
  };
  connectionSummary: {
    private: {
      value?: string;
    };
    public: {
      enabled: boolean;
      value?: string;
    };
  };
  displayName: string;
  engine: {
    displayName: string;
    key?: string;
  };
  key: ProjectRuntimeFactKey;
  metadataLabels?: Record<string, unknown>;
  observedUid?: string;
  ref: CanvasLayoutResourceRef & { kind: "DB" };
  status: ProjectRuntimeStatusSummary;
  version?: string;
}

export interface PublicAccessTargetSummary {
  id: string;
  label: string;
  port: number;
  status?: ProjectRuntimeStatusSummary;
  type?: string;
  value: string;
}

export interface PublicAccessFact {
  accessDomain?: {
    label: "Access domain";
    value: string;
  };
  apRef: CanvasLayoutResourceRef & { kind: "AP" };
  displayName: string;
  key: ProjectRuntimeFactKey;
  observedUid?: string;
  ref: CanvasLayoutResourceRef & { kind: "PublicAccess" };
  targets: PublicAccessTargetSummary[];
}

export interface ProjectRuntimeFacts {
  apFacts: ApFact[];
  dbFacts: DbFact[];
  publicAccessFacts: PublicAccessFact[];
  relationshipIndexes: ProjectRuntimeRelationshipIndexes;
}

export interface ProjectRuntimeFactsInput {
  apsData?: K8sGetResponse;
  dbsData?: K8sGetResponse;
  namespace: string;
}

const STATUS_TONES = new Set([
  "creating",
  "deleting",
  "failed",
  "paused",
  "pending",
  "restarting",
  "running",
  "starting",
  "stopped",
  "stopping",
  "updating",
]);
const PUBLIC_ACCESS_BLOCKING_AP_TONES = new Set([
  "creating",
  "deleting",
  "failed",
  "pending",
  "restarting",
  "starting",
  "stopped",
  "stopping",
  "updating",
]);

const DISPLAY_ENGINE_BY_KEY: Record<string, string> = {
  mongodb: "MongoDB",
  mysql: "MySQL",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  redis: "Redis",
};

const VERSION_NUMBER_PATTERN = /\d+(?:\.\d+)+/;
const PUBLIC_ACCESS_PROTOCOL_PATTERN = /^https?:\/\//;
const PUBLIC_ACCESS_STATUS_SEPARATOR_PATTERN = /[\s_]+/g;
const PUBLIC_ACCESS_TRAILING_SLASH_PATTERN = /\/$/;

interface NetworkPublicAddress {
  cnameTarget?: string;
  host?: string;
  id?: string;
  platformAddressId?: string;
  port: number;
  status?: string;
  type?: string;
  url?: string;
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

function metadataRecord(resource: unknown): Record<string, unknown> {
  return asRecord(asRecord(resource)?.metadata) ?? {};
}

function metadataName(resource: unknown): string | undefined {
  return nonEmptyString(metadataRecord(resource).name);
}

function metadataNamespace(resource: unknown): string | undefined {
  return nonEmptyString(metadataRecord(resource).namespace);
}

function metadataUid(resource: unknown): string | undefined {
  return nonEmptyString(metadataRecord(resource).uid);
}

function metadataLabels(
  resource: unknown
): Record<string, unknown> | undefined {
  const labels = asRecord(metadataRecord(resource).labels);
  return labels === undefined ? undefined : { ...labels };
}

export function projectRuntimeResourceKey(
  ref: Pick<CanvasLayoutResourceRef, "kind" | "name" | "namespace">
): ProjectRuntimeFactKey {
  return `${ref.kind}:${ref.namespace}:${ref.name}`;
}

function statusTone(status: string): string {
  const tone = status.trim().toLowerCase();
  return STATUS_TONES.has(tone) ? tone : "pending";
}

function apStatusSummary(ap: unknown): ProjectRuntimeStatusSummary {
  const root = asRecord(ap) ?? {};
  const spec = asRecord(root.spec) ?? {};
  const status = asRecord(root.status) ?? {};
  let phase = nonEmptyString(status.phase) ?? "Unknown";
  if (readApIsPaused(spec)) {
    phase = "Paused";
  }
  return {
    label: phase,
    tone: statusTone(phase),
  };
}

function displayEngineFromKey(engineKey: string | undefined): string {
  if (engineKey === undefined) {
    return "Unknown";
  }
  const normalized = engineKey.toLowerCase();
  return DISPLAY_ENGINE_BY_KEY[normalized] ?? engineKey;
}

function formatDatabaseVersion(
  rawVersion: string | undefined,
  engineKey: string | undefined
): string | undefined {
  const version = nonEmptyString(rawVersion);
  if (version === undefined) {
    return undefined;
  }

  const numericVersion = version.match(VERSION_NUMBER_PATTERN)?.[0] ?? version;
  if (
    engineKey?.toLowerCase() === "postgresql" &&
    numericVersion.endsWith(".0")
  ) {
    return numericVersion.slice(0, -2);
  }
  return numericVersion;
}

function dbStatusSummary(
  status: Record<string, unknown>
): ProjectRuntimeStatusSummary {
  const phase = nonEmptyString(status.phase) ?? "Unknown";
  return {
    label: phase,
    tone: statusTone(phase),
  };
}

function dbCapacitySummary(
  spec: Record<string, unknown>
): DbFact["capacitySummary"] {
  const capacity = {
    ...(nonEmptyString(spec.cpuLimit) === undefined
      ? {}
      : { cpu: nonEmptyString(spec.cpuLimit) }),
    ...(nonEmptyString(spec.memoryLimit) === undefined
      ? {}
      : { memory: nonEmptyString(spec.memoryLimit) }),
    ...(nonEmptyString(spec.storageSize) === undefined
      ? {}
      : { storage: nonEmptyString(spec.storageSize) }),
  };
  return Object.keys(capacity).length === 0 ? undefined : capacity;
}

function dbFactFromResource(
  db: unknown,
  namespaceFallback: string
): DbFact | undefined {
  const root = asRecord(db) ?? {};
  const spec = asRecord(root.spec) ?? {};
  const status = asRecord(root.status) ?? {};
  const name = metadataName(db);
  const namespace = metadataNamespace(db) ?? namespaceFallback;
  if (name === undefined || namespace === "") {
    return undefined;
  }

  const ref: DbFact["ref"] = { kind: "DB", name, namespace };
  const engineKey = nonEmptyString(spec.engine);
  const capacitySummary = dbCapacitySummary(spec);
  const labels = metadataLabels(db);
  return {
    ...(capacitySummary === undefined ? {} : { capacitySummary }),
    connectionSummary: {
      private: {
        ...(nonEmptyString(status.connectionStringPrivate) === undefined
          ? {}
          : { value: nonEmptyString(status.connectionStringPrivate) }),
      },
      public: {
        enabled: spec.exposeNodePort === true,
        ...(nonEmptyString(status.connectionStringPublic) === undefined
          ? {}
          : { value: nonEmptyString(status.connectionStringPublic) }),
      },
    },
    displayName: name,
    engine: {
      displayName: displayEngineFromKey(engineKey),
      ...(engineKey === undefined ? {} : { key: engineKey }),
    },
    key: projectRuntimeResourceKey(ref),
    ...(labels === undefined ? {} : { metadataLabels: labels }),
    ...(metadataUid(db) === undefined ? {} : { observedUid: metadataUid(db) }),
    ref,
    status: dbStatusSummary(status),
    ...(formatDatabaseVersion(
      nonEmptyString(status.clusterVersionRef),
      engineKey
    ) === undefined
      ? {}
      : {
          version: formatDatabaseVersion(
            nonEmptyString(status.clusterVersionRef),
            engineKey
          ),
        }),
  };
}

function publicAccessTargetPort(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) {
    return input;
  }
  if (typeof input === "string") {
    const n = Number(input);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function networkPublicAddressFromRecord(
  raw: unknown
): NetworkPublicAddress | undefined {
  const record = asRecord(raw);
  if (record === undefined) {
    return undefined;
  }
  const host = nonEmptyString(record.host);
  const id = nonEmptyString(record.id);
  const port = publicAccessTargetPort(record.port);
  if ((host === undefined && id === undefined) || port === undefined) {
    return undefined;
  }

  return {
    ...(nonEmptyString(record.cnameTarget) === undefined
      ? {}
      : { cnameTarget: nonEmptyString(record.cnameTarget) }),
    ...(host === undefined ? {} : { host }),
    ...(id === undefined ? {} : { id }),
    ...(nonEmptyString(record.platformAddressId) === undefined
      ? {}
      : { platformAddressId: nonEmptyString(record.platformAddressId) }),
    port,
    ...(nonEmptyString(record.status) === undefined
      ? {}
      : { status: nonEmptyString(record.status) }),
    ...(nonEmptyString(record.type) === undefined
      ? {}
      : { type: nonEmptyString(record.type) }),
    ...(nonEmptyString(record.url) === undefined
      ? {}
      : { url: nonEmptyString(record.url) }),
  };
}

function normalizeNetworkPublicAddresses(raw: unknown): NetworkPublicAddress[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((item) => {
    const address = networkPublicAddressFromRecord(item);
    return address === undefined ? [] : [address];
  });
}

function normalizeDesiredPlatformAddresses(
  raw: unknown
): NetworkPublicAddress[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: NetworkPublicAddress[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (record === undefined) {
      continue;
    }
    const id = platformAddressIdFromValue(record.id);
    const port = publicAccessTargetPort(record.port);
    if (id === undefined || port === undefined) {
      continue;
    }
    out.push({ id, port, status: "progressing", type: "platform" });
  }
  return out;
}

function isCustomPublicAddressRow(address: NetworkPublicAddress): boolean {
  return address.type?.trim().toLowerCase() === "custom";
}

function isPlatformPublicAddressRow(address: NetworkPublicAddress): boolean {
  return !isCustomPublicAddressRow(address);
}

function platformAddressIdsFromCustomRows(
  addresses: readonly NetworkPublicAddress[]
): Set<string> {
  const ids = new Set<string>();
  for (const address of addresses) {
    if (
      isCustomPublicAddressRow(address) &&
      address.platformAddressId !== undefined
    ) {
      ids.add(address.platformAddressId);
    }
  }
  return ids;
}

function isKnownPlatformAddress(
  address: NetworkPublicAddress,
  observedIds: ReadonlySet<string>,
  promotedPlatformAddressIds: ReadonlySet<string>
): boolean {
  return (
    address.id !== undefined &&
    (observedIds.has(address.id) || promotedPlatformAddressIds.has(address.id))
  );
}

function publicAddressesForAp(ap: unknown): NetworkPublicAddress[] {
  const root = asRecord(ap) ?? {};
  const statusNetwork = asRecord(asRecord(root.status)?.network);
  const inputNetwork = asRecord(asRecord(asRecord(root.spec)?.input)?.network);
  const statusAddresses = normalizeNetworkPublicAddresses(
    statusNetwork?.publicAddresses
  );
  const desiredPending = normalizeDesiredPlatformAddresses(
    inputNetwork?.platformAddresses
  );
  if (statusAddresses.length === 0) {
    return desiredPending;
  }
  const observedPlatformAddresses = statusAddresses.filter(
    isPlatformPublicAddressRow
  );
  const observedIds = platformAddressIdsFromRows(observedPlatformAddresses);
  const promotedPlatformAddressIds =
    platformAddressIdsFromCustomRows(statusAddresses);
  return [
    ...statusAddresses,
    ...desiredPending.filter(
      (address) =>
        !isKnownPlatformAddress(
          address,
          observedIds,
          promotedPlatformAddressIds
        )
    ),
  ];
}

function publicAddressTargetLabel(type: string | undefined): string {
  switch (type?.toLowerCase()) {
    case "platform":
      return "Platform Address";
    case "custom":
    case "custom-domain":
      return "Custom Domain";
    default:
      return "Public Address";
  }
}

function titleCaseStatus(status: string): string {
  return status
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function publicAccessTargetStatus(
  status: string | undefined,
  apStatus: ProjectRuntimeStatusSummary
): ProjectRuntimeStatusSummary | undefined {
  if (status === undefined) {
    return { label: "Unknown", tone: "unknown" };
  }
  const tone = status
    .toLowerCase()
    .replace(PUBLIC_ACCESS_STATUS_SEPARATOR_PATTERN, "-");
  const apTone = apStatus.tone?.trim().toLowerCase();
  if (
    tone === "accessible" &&
    apTone !== undefined &&
    PUBLIC_ACCESS_BLOCKING_AP_TONES.has(apTone)
  ) {
    return { label: apStatus.label, tone: apTone };
  }
  return { label: titleCaseStatus(tone), tone };
}

function publicAccessTargetsFromAddresses(
  addresses: readonly NetworkPublicAddress[],
  apStatus: ProjectRuntimeStatusSummary
): PublicAccessTargetSummary[] {
  return addresses.map((address, index) => {
    const host = address.host;
    return {
      id: address.id ?? `${address.port}-${host ?? `pending-${index}`}`,
      label: publicAddressTargetLabel(address.type),
      port: address.port,
      status: publicAccessTargetStatus(address.status, apStatus),
      ...(address.type === undefined ? {} : { type: address.type }),
      value:
        address.url ?? (host === undefined ? "Pending" : `https://${host}/`),
    };
  });
}

function accessDomainFromTargets(
  targets: readonly PublicAccessTargetSummary[]
): PublicAccessFact["accessDomain"] {
  const first = targets[0];
  if (first === undefined) {
    return undefined;
  }
  const value = first.value
    .replace(PUBLIC_ACCESS_PROTOCOL_PATTERN, "")
    .replace(PUBLIC_ACCESS_TRAILING_SLASH_PATTERN, "");
  return { label: "Access domain", value };
}

function publicAccessFactFromAp(
  ap: unknown,
  namespaceFallback: string
): PublicAccessFact | undefined {
  const publicAddresses = publicAddressesForAp(ap);
  if (publicAddresses.length === 0) {
    return undefined;
  }
  const apName = metadataName(ap);
  const namespace = metadataNamespace(ap) ?? namespaceFallback;
  if (apName === undefined || namespace === "") {
    return undefined;
  }
  const apRef: PublicAccessFact["apRef"] = {
    kind: "AP",
    name: apName,
    namespace,
  };
  const ref: PublicAccessFact["ref"] = {
    kind: "PublicAccess",
    name: apName,
    namespace,
  };
  const targets = publicAccessTargetsFromAddresses(
    publicAddresses,
    apStatusSummary(ap)
  );
  const accessDomain = accessDomainFromTargets(targets);
  return {
    ...(accessDomain === undefined ? {} : { accessDomain }),
    apRef,
    displayName: apName,
    key: projectRuntimeResourceKey(ref),
    ...(metadataUid(ap) === undefined ? {} : { observedUid: metadataUid(ap) }),
    ref,
    targets,
  };
}

function finiteNumber(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input)
    ? input
    : undefined;
}

function apReplicaSummary(
  ap: unknown,
  spec: Record<string, unknown>
): ApFact["replicaSummary"] {
  const desired = readApReplicas(spec);
  const ready = finiteNumber(asRecord(asRecord(ap)?.status)?.readyReplicas);
  if (desired === undefined && ready === undefined) {
    return undefined;
  }
  return {
    ...(desired === undefined ? {} : { desired }),
    ...(ready === undefined ? {} : { ready }),
  };
}

function apFactFromResource(
  ap: unknown,
  namespaceFallback: string
): ApFact | undefined {
  const root = asRecord(ap) ?? {};
  const spec = asRecord(root.spec) ?? {};
  const name = metadataName(ap);
  const namespace = metadataNamespace(ap) ?? namespaceFallback;
  if (name === undefined || namespace === "") {
    return undefined;
  }

  const ref: ApFact["ref"] = { kind: "AP", name, namespace };
  const replicaSummary = apReplicaSummary(ap, spec);
  return {
    displayName: name,
    key: projectRuntimeResourceKey(ref),
    ...(metadataUid(ap) === undefined ? {} : { observedUid: metadataUid(ap) }),
    ref,
    ...(replicaSummary === undefined ? {} : { replicaSummary }),
    status: apStatusSummary(ap),
    workload: {
      image: readApImage(spec) ?? "—",
      kind: "AP",
    },
  };
}

export function projectRuntimeFactsFromResources({
  apsData,
  dbsData,
  namespace,
}: ProjectRuntimeFactsInput): ProjectRuntimeFacts {
  return {
    apFacts: apItemsFromList(apsData).flatMap((ap) => {
      const fact = apFactFromResource(ap, namespace);
      return fact === undefined ? [] : [fact];
    }),
    dbFacts: apItemsFromList(dbsData).flatMap((db) => {
      const fact = dbFactFromResource(db, namespace);
      return fact === undefined ? [] : [fact];
    }),
    publicAccessFacts: apItemsFromList(apsData).flatMap((ap) => {
      const fact = publicAccessFactFromAp(ap, namespace);
      return fact === undefined ? [] : [fact];
    }),
    relationshipIndexes: projectRuntimeRelationshipIndexesFromResources({
      apsData,
      dbsData,
      namespaceFallback: namespace,
    }),
  };
}
