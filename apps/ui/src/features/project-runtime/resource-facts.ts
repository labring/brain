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
import { BRAIN_DEPLOYMENT_KIND_LABEL } from "@/lib/brain-labels";

export type ProjectRuntimeResourceKind =
  | "AP"
  | "DB"
  | "PublicAccess"
  | "TemplateNativeWorkload";

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
    replicas: number;
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

export interface TemplateNativeWorkloadRef {
  kind: "TemplateNativeWorkload";
  name: string;
  namespace: string;
  workloadKind: string;
}

export interface TemplateNativeWorkloadFact {
  displayName: string;
  key: ProjectRuntimeFactKey;
  observedUid?: string;
  ref: TemplateNativeWorkloadRef;
  replicaSummary?: {
    replicas: number;
  };
  status: ProjectRuntimeStatusSummary;
  workload: {
    image: string;
    kind: string;
  };
}

export interface ProjectRuntimeFacts {
  apFacts: ApFact[];
  dbFacts: DbFact[];
  publicAccessFacts: PublicAccessFact[];
  templateNativeWorkloadFacts: TemplateNativeWorkloadFact[];
}

export interface ProjectRuntimeFactsInput {
  apsData?: K8sGetResponse;
  dbsData?: K8sGetResponse;
  namespace: string;
  templateNativeData?: {
    deployments?: K8sGetResponse;
    statefulSets?: K8sGetResponse;
  };
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
  status: Record<string, unknown>
): DbFact["capacitySummary"] {
  const effectiveResources = asRecord(status.effectiveResources);
  if (effectiveResources === undefined) {
    return undefined;
  }
  const capacity = {
    ...(nonEmptyString(effectiveResources.cpuLimit) === undefined
      ? {}
      : { cpu: nonEmptyString(effectiveResources.cpuLimit) }),
    ...(nonEmptyString(effectiveResources.memoryLimit) === undefined
      ? {}
      : { memory: nonEmptyString(effectiveResources.memoryLimit) }),
    ...(nonEmptyString(effectiveResources.storageSize) === undefined
      ? {}
      : { storage: nonEmptyString(effectiveResources.storageSize) }),
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
  const capacitySummary = dbCapacitySummary(status);
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
  status: string | undefined
): ProjectRuntimeStatusSummary | undefined {
  if (status === undefined) {
    return { label: "Unknown", tone: "unknown" };
  }
  const tone = status
    .toLowerCase()
    .replace(PUBLIC_ACCESS_STATUS_SEPARATOR_PATTERN, "-");
  return { label: titleCaseStatus(tone), tone };
}

function publicAccessTargetsFromAddresses(
  addresses: readonly NetworkPublicAddress[]
): PublicAccessTargetSummary[] {
  return addresses.map((address, index) => {
    const host = address.host;
    return {
      id: address.id ?? `${address.port}-${host ?? `pending-${index}`}`,
      label: publicAddressTargetLabel(address.type),
      port: address.port,
      status: publicAccessTargetStatus(address.status),
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
  const targets = publicAccessTargetsFromAddresses(publicAddresses);
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

function templateNativeImage(item: unknown): string {
  const spec = asRecord(asRecord(item)?.spec) ?? {};
  const containers =
    asRecord(asRecord(spec.template)?.spec)?.containers ??
    asRecord(spec)?.containers;
  if (!Array.isArray(containers)) {
    return "—";
  }
  const image = asRecord(containers[0])?.image;
  return typeof image === "string" && image !== "" ? image : "—";
}

function templateNativeReplicas(item: unknown): number | undefined {
  const replicas = asRecord(asRecord(item)?.spec)?.replicas;
  return typeof replicas === "number" && Number.isFinite(replicas)
    ? replicas
    : undefined;
}

function templateNativeStatus(item: unknown): ProjectRuntimeStatusSummary {
  const status = asRecord(asRecord(item)?.status) ?? {};
  const phase =
    nonEmptyString(status.phase) ??
    (typeof status.readyReplicas === "number" &&
    typeof status.replicas === "number" &&
    status.replicas > 0 &&
    status.readyReplicas >= status.replicas
      ? "Running"
      : "Creating");
  return {
    label: phase,
    tone: statusTone(phase),
  };
}

function isTemplateNativeWorkload(item: unknown): boolean {
  const labels = asRecord(asRecord(asRecord(item)?.metadata)?.labels) ?? {};
  const kind = nonEmptyString(asRecord(item)?.kind);
  return (
    labels[BRAIN_DEPLOYMENT_KIND_LABEL] === "template" &&
    (kind === "Deployment" || kind === "StatefulSet")
  );
}

function apLikeWorkloadKeys(
  apsData: K8sGetResponse | undefined,
  namespaceFallback: string
): Set<string> {
  const keys = new Set<string>();
  for (const item of apItemsFromList(apsData)) {
    const name = metadataName(item);
    const namespace = metadataNamespace(item) ?? namespaceFallback;
    if (name !== undefined && namespace !== "") {
      keys.add(`${namespace}/${name}`);
    }
  }
  return keys;
}

function templateNativeWorkloadKey(
  item: unknown,
  namespaceFallback: string
): string | undefined {
  const name = metadataName(item);
  const namespace = metadataNamespace(item) ?? namespaceFallback;
  return name !== undefined && namespace !== ""
    ? `${namespace}/${name}`
    : undefined;
}

function templateNativeFactKey(ref: TemplateNativeWorkloadRef): string {
  return `${ref.kind}:${ref.namespace}:${ref.workloadKind}:${ref.name}`;
}

function templateNativeFactFromResource(
  item: unknown,
  namespaceFallback: string
): TemplateNativeWorkloadFact | undefined {
  if (!isTemplateNativeWorkload(item)) {
    return undefined;
  }
  const name = metadataName(item);
  const namespace = metadataNamespace(item) ?? namespaceFallback;
  const workloadKind = nonEmptyString(asRecord(item)?.kind) ?? "Workload";
  if (name === undefined || namespace === "") {
    return undefined;
  }

  const ref: TemplateNativeWorkloadRef = {
    kind: "TemplateNativeWorkload",
    name,
    namespace,
    workloadKind,
  };
  const replicas = templateNativeReplicas(item);
  return {
    displayName: name,
    key: templateNativeFactKey(ref),
    ...(metadataUid(item) === undefined
      ? {}
      : { observedUid: metadataUid(item) }),
    ref,
    ...(replicas === undefined ? {} : { replicaSummary: { replicas } }),
    status: templateNativeStatus(item),
    workload: {
      image: templateNativeImage(item),
      kind: workloadKind,
    },
  };
}

function templateNativeFactsFromResources({
  apsData,
  namespace,
  templateNativeData,
}: Pick<
  ProjectRuntimeFactsInput,
  "apsData" | "namespace" | "templateNativeData"
>): TemplateNativeWorkloadFact[] {
  const apLikeKeys = apLikeWorkloadKeys(apsData, namespace);
  return [
    ...apItemsFromList(templateNativeData?.deployments),
    ...apItemsFromList(templateNativeData?.statefulSets),
  ].flatMap((item) => {
    const workloadKey = templateNativeWorkloadKey(item, namespace);
    if (workloadKey !== undefined && apLikeKeys.has(workloadKey)) {
      return [];
    }
    const fact = templateNativeFactFromResource(item, namespace);
    return fact === undefined ? [] : [fact];
  });
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
  const replicas = readApReplicas(spec);
  return {
    displayName: name,
    key: projectRuntimeResourceKey(ref),
    ...(metadataUid(ap) === undefined ? {} : { observedUid: metadataUid(ap) }),
    ref,
    ...(typeof replicas === "number" ? { replicaSummary: { replicas } } : {}),
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
  templateNativeData,
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
    templateNativeWorkloadFacts: templateNativeFactsFromResources({
      apsData,
      namespace,
      templateNativeData,
    }),
  };
}
