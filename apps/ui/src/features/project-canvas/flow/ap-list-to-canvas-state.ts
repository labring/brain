import type {
  WorkloadTelemetrySnapshotKind,
  WorkloadTelemetrySnapshotMetric,
  WorkloadTelemetrySnapshotResponse,
} from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import type {
  EntryNodeAccessDomain,
  EntryNodeTarget,
  EntryNodeTargetStatus,
} from "@workspace/ui/components/entry-node/entry-node";
import type { Edge, Node } from "@xyflow/react";

import {
  readApImage,
  readApIsPaused,
  readApReplicas,
} from "@/features/project-settings/ap/k8s/ap-spec-access";
import { dbResourceToSettingsData } from "@/features/project-settings/db/db-settings-resource";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "../nodes/constants";
import { publicAccessSelectionKey } from "../nodes/entry-node-selection";
import type { CanvasDatabaseNodeData } from "../nodes/types";
import {
  platformAddressIdFromValue,
  platformAddressIdsFromRows,
} from "../platform-addresses";

const FALLBACK_COLUMNS = 3;
const FALLBACK_COL_GAP = 340;
const FALLBACK_ROW_GAP = 280;

function fallbackCanvasPosition(index: number): { x: number; y: number } {
  return {
    x: (index % FALLBACK_COLUMNS) * FALLBACK_COL_GAP,
    y: Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_ROW_GAP,
  };
}

const ENTRY_NODE_PROTOCOL_PATTERN = /^https?:\/\//;
const ENTRY_NODE_STATUS_SEPARATOR_PATTERN = /[\s_]+/g;
const ENTRY_NODE_TRAILING_SLASH_PATTERN = /\/$/;
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

function getToneForStatus(status: string | null | undefined) {
  const normalized = status?.trim().toLowerCase();
  return normalized && STATUS_TONES.has(normalized) ? normalized : undefined;
}

export interface WorkloadMetricPercents {
  cpuPercent?: number;
  memoryPercent?: number;
  storagePercent?: number;
}

function roundedMetricPercent(
  value: number | string | undefined
): number | undefined {
  if (value == null || value === "") {
    return undefined;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

/** Map key for merging telemetry into AP/DB workload nodes (`kind:ns:name`). */
export function telemetryWorkloadKey(
  kind: WorkloadTelemetrySnapshotKind,
  namespace: string,
  name: string
): string {
  return `${kind}:${namespace}:${name}`;
}

export function apMetricsLookupFromSnapshot(
  response: WorkloadTelemetrySnapshotResponse | undefined
): Map<string, WorkloadMetricPercents> {
  const map = new Map<string, WorkloadMetricPercents>();
  if (response == null) {
    return map;
  }
  for (const item of response.items) {
    const { target } = item;
    if (target.kind !== "ap") {
      continue;
    }
    const metrics: WorkloadMetricPercents = {};
    const cpuPercent = metricSamplePercent(item.metrics?.cpu);
    const memoryPercent = metricSamplePercent(item.metrics?.memory);
    if (cpuPercent !== undefined) {
      metrics.cpuPercent = cpuPercent;
    }
    if (memoryPercent !== undefined) {
      metrics.memoryPercent = memoryPercent;
    }
    map.set(telemetryWorkloadKey("ap", target.namespace, target.name), metrics);
  }
  return map;
}

function metricSamplePercent(
  metric: WorkloadTelemetrySnapshotMetric | undefined
): number | undefined {
  return metric === undefined ? undefined : roundedMetricPercent(metric.value);
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === "object"
    ? (v as Record<string, unknown>)
    : undefined;
}

function metadataName(item: unknown): string | undefined {
  const meta = asRecord(asRecord(item)?.metadata)?.name;
  return typeof meta === "string" ? meta : undefined;
}

function metadataUid(item: unknown): string | undefined {
  const uid = asRecord(asRecord(item)?.metadata)?.uid;
  return typeof uid === "string" ? uid : undefined;
}

function metadataNamespace(item: unknown): string | undefined {
  const namespace = asRecord(asRecord(item)?.metadata)?.namespace;
  return typeof namespace === "string" ? namespace : undefined;
}

function nonEmptyString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim() !== ""
    ? input.trim()
    : undefined;
}

function containerMetricsFromTelemetry(
  telemetry: WorkloadMetricPercents | undefined
): ContainerNodeStates["metrics"] {
  return {
    ...(telemetry?.cpuPercent === undefined
      ? {}
      : { cpu: telemetry.cpuPercent }),
    ...(telemetry?.memoryPercent === undefined
      ? {}
      : { memory: telemetry.memoryPercent }),
  };
}

/**
 * Maps one AP product view into {@link ContainerNodeStates}.
 * Sets **kind**, **image**, **name**, **replicas** (from AP replica strategy), **uid**
 * (from `metadata.uid` when present), and **status** from `status.phase`.
 * When paused or desired replicas are zero, status is shown as **Paused** regardless of `status.phase`.
 */
export function apToWorkloadStates(ap: unknown): ContainerNodeStates {
  const root = asRecord(ap) ?? {};
  const spec = asRecord(root.spec) ?? {};
  const status = asRecord(root.status) ?? {};
  const meta = asRecord(root.metadata) ?? {};

  const name =
    typeof meta.name === "string" && meta.name !== "" ? meta.name : "unknown";
  const image = readApImage(spec) ?? "—";

  const replicas = readApReplicas(spec);

  let phaseRaw = typeof status.phase === "string" ? status.phase.trim() : "";
  if (readApIsPaused(spec)) {
    phaseRaw = "Paused";
  }

  const label = phaseRaw === "" ? "Unknown" : phaseRaw;
  const phaseForTone = phaseRaw === "" ? "unknown" : phaseRaw.toLowerCase();
  const tone = getToneForStatus(phaseForTone) ?? "pending";

  const uid = metadataUid(ap);

  return {
    kind: "AP",
    name,
    image,
    ...(typeof replicas === "number" ? { replicas } : {}),
    ...(uid != null && uid !== "" ? { uid } : {}),
    status: { label, tone },
  };
}

export interface ApsToCanvasStateOptions {
  /** Index offset for deterministic fallback placement when combining node lists. @default 0 */
  gridIndexOffset?: number;
  /** Key from {@link telemetryWorkloadKey} -> latest workload metric % from telemetry. */
  metricsLookup?: Map<string, WorkloadMetricPercents>;
  /** Used when a list item has no `metadata.namespace` (same as k8s list query). */
  namespaceFallback?: string;
}

export interface DbsToCanvasStateOptions {
  /** DB engine key -> icon URL/data URI. */
  engineIconByName?: ReadonlyMap<string, string>;
  /** Index offset for deterministic fallback placement when combining node lists. @default 0 */
  gridIndexOffset?: number;
  /** Key from {@link telemetryWorkloadKey} -> latest workload metric % from telemetry. */
  metricsLookup?: Map<string, WorkloadMetricPercents>;
  /** Used when a list item has no `metadata.namespace` (same as k8s list query). */
  namespaceFallback?: string;
}

export interface PublicAccessToCanvasStateOptions {
  /** Index offset for deterministic fallback placement when combining node lists. @default 0 */
  gridIndexOffset?: number;
  /** Used when a list item has no `metadata.namespace` (same as k8s list query). */
  namespaceFallback?: string;
}

/**
 * Builds React Flow `nodes` / `edges` for the project AP list (canvas state).
 */
export function apsToCanvasState(
  data: K8sGetResponse | undefined,
  options?: ApsToCanvasStateOptions
): { edges: Edge[]; nodes: Node[] } {
  const items = apItemsFromList(data);
  const grid0 = options?.gridIndexOffset ?? 0;
  const nodes: Node[] = items.map((item, i) => {
    const stable = metadataName(item) ?? metadataUid(item) ?? `i-${i}`;
    const meta = asRecord(asRecord(item)?.metadata) ?? {};
    const ns =
      typeof meta.namespace === "string" && meta.namespace !== ""
        ? meta.namespace
        : options?.namespaceFallback;
    const n = typeof meta.name === "string" ? meta.name : "";
    const lookupKey =
      ns === undefined || ns === "" || n === ""
        ? undefined
        : telemetryWorkloadKey("ap", ns, n);
    const tel =
      lookupKey === undefined
        ? undefined
        : options?.metricsLookup?.get(lookupKey);
    const base = apToWorkloadStates(item);
    const states: ContainerNodeStates = {
      ...base,
      metrics: containerMetricsFromTelemetry(tel),
      ...(ns !== undefined && ns !== "" ? { namespace: ns } : {}),
    };
    const g = grid0 + i;
    return {
      data: { states },
      id: `ap-${String(stable).replace(/\s+/g, "-")}`,
      position: fallbackCanvasPosition(g),
      type: CANVAS_CONTAINER_NODE_TYPE,
    };
  });
  return { nodes, edges: [] };
}

/**
 * Maps one DB product view into `DatabaseNode` props.
 */
export function dbToDatabaseNodeData(
  db: unknown,
  options?: Pick<
    DbsToCanvasStateOptions,
    "engineIconByName" | "metricsLookup" | "namespaceFallback"
  >
): CanvasDatabaseNodeData {
  return dbResourceToSettingsData(db, options);
}

/**
 * Builds React Flow `nodes` / `edges` for project DB resources using `DatabaseNode`.
 */
export function dbsToCanvasState(
  data: K8sGetResponse | undefined,
  options?: DbsToCanvasStateOptions
): { edges: Edge[]; nodes: Node[] } {
  const items = apItemsFromList(data);
  const grid0 = options?.gridIndexOffset ?? 0;
  const nodes: Node[] = items.map((item, i) => {
    const stable = metadataName(item) ?? metadataUid(item) ?? `i-${i}`;
    const g = grid0 + i;
    return {
      data: dbToDatabaseNodeData(item, options),
      id: `db-${String(stable).replace(/\s+/g, "-")}`,
      position: fallbackCanvasPosition(g),
      type: CANVAS_DATABASE_NODE_TYPE,
    };
  });
  return { nodes, edges: [] };
}

/**
 * Builds React Flow `nodes` / `edges` for AP Public Access Nodes.
 */
export function publicAccessToCanvasState(
  apsData: K8sGetResponse | undefined,
  options?: PublicAccessToCanvasStateOptions
): { edges: Edge[]; nodes: Node[] } {
  const items = publicAccessCanvasResources(apsData, options);
  const grid0 = options?.gridIndexOffset ?? 0;
  const nodes: Node[] = items.map((item, i) => {
    const stable = item.stableName;
    const name = item.name;
    const namespace = item.namespace;
    const uid = item.uid;
    const targets = item.targets;
    const accessDomain = entryNodeAccessDomainFromTargets(targets);
    const g = grid0 + i;
    const apRef = item.apRef;
    const selectionKey =
      apRef === undefined || namespace === ""
        ? undefined
        : publicAccessSelectionKey({ apName: apRef, namespace });

    return {
      data: {
        ...(accessDomain === undefined ? {} : { accessDomain }),
        resource: {
          ...(apRef === undefined ? {} : { apRef }),
          name,
          namespace,
          ...(selectionKey === undefined ? {} : { selectionKey }),
          ...(uid === undefined || uid === "" ? {} : { uid }),
        },
        states: { name },
        targets,
      },
      id: `entry-${String(stable).replace(/\s+/g, "-")}`,
      position: fallbackCanvasPosition(g),
      type: CANVAS_ENTRY_NODE_TYPE,
    };
  });
  return { nodes, edges: [] };
}

interface PublicAccessCanvasResource {
  apRef?: string;
  name: string;
  namespace: string;
  stableName: string;
  targets: EntryNodeTarget[];
  uid?: string;
}

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

function publicAccessCanvasResources(
  apsData: K8sGetResponse | undefined,
  options: PublicAccessToCanvasStateOptions | undefined
): PublicAccessCanvasResource[] {
  const resources: PublicAccessCanvasResource[] = [];
  for (const ap of apItemsFromList(apsData)) {
    const publicAddresses = apNetworkPublicAddresses(ap);
    if (publicAddresses.length === 0) {
      continue;
    }
    const apName = metadataName(ap);
    const namespace = metadataNamespace(ap) ?? options?.namespaceFallback ?? "";
    if (apName === undefined || namespace === "") {
      continue;
    }
    resources.push({
      apRef: apName,
      name: apName,
      namespace,
      stableName: apName,
      targets: entryNodeTargetsFromPublicAddresses(publicAddresses),
    });
  }
  return resources;
}

function apNetworkPublicAddresses(ap: unknown): NetworkPublicAddress[] {
  const root = asRecord(ap) ?? {};
  const statusNetwork = asRecord(asRecord(root.status)?.network);
  const inputNetwork = asRecord(asRecord(asRecord(root.spec)?.input)?.network);
  const statusAddresses = normalizeNetworkPublicAddresses(
    statusNetwork?.publicAddresses,
    true
  );
  const desiredPending = normalizeDesiredPlatformAddresses(
    inputNetwork?.platformAddresses
  );
  if (statusAddresses.length > 0) {
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
  return desiredPending;
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

function normalizeNetworkPublicAddresses(
  raw: unknown,
  includeObservedFields: boolean
): NetworkPublicAddress[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: NetworkPublicAddress[] = [];
  for (const item of raw) {
    const address = networkPublicAddressFromRecord(item, includeObservedFields);
    if (address !== undefined) {
      out.push(address);
    }
  }
  return out;
}

function networkPublicAddressFromRecord(
  raw: unknown,
  includeObservedFields: boolean
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

  const address: NetworkPublicAddress = {
    ...(host === undefined ? {} : { host }),
    ...(id === undefined ? {} : { id }),
    port,
  };
  if (!includeObservedFields) {
    return address;
  }

  const status = nonEmptyString(record.status);
  const type = nonEmptyString(record.type);
  const url = nonEmptyString(record.url);
  const platformAddressId = nonEmptyString(record.platformAddressId);
  const cnameTarget = nonEmptyString(record.cnameTarget);
  if (status !== undefined) {
    address.status = status;
  }
  if (type !== undefined) {
    address.type = type;
  }
  if (url !== undefined) {
    address.url = url;
  }
  if (platformAddressId !== undefined) {
    address.platformAddressId = platformAddressId;
  }
  if (cnameTarget !== undefined) {
    address.cnameTarget = cnameTarget;
  }
  return address;
}

function entryNodeTargetsFromPublicAddresses(
  addresses: readonly NetworkPublicAddress[]
): EntryNodeTarget[] {
  return addresses.map((address, index) => {
    const host = address.host;
    const id = address.id ?? `${address.port}-${host ?? `pending-${index}`}`;
    return {
      id,
      label: publicAddressTargetLabel(address.type),
      status: publicAccessTargetStatus(address.status),
      value:
        address.url ?? (host === undefined ? "Pending" : `https://${host}/`),
    };
  });
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

function entryNodeAccessDomainFromTargets(
  targets: readonly EntryNodeTarget[]
): EntryNodeAccessDomain | undefined {
  const first = targets[0];
  if (first === undefined) {
    return undefined;
  }
  const value = first.value
    .replace(ENTRY_NODE_PROTOCOL_PATTERN, "")
    .replace(ENTRY_NODE_TRAILING_SLASH_PATTERN, "");
  return { label: "Access domain", value };
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

function publicAccessTargetStatus(
  input: unknown
): EntryNodeTargetStatus | undefined {
  const status = nonEmptyString(input);
  if (status === undefined) {
    return { label: "Unknown", tone: "unknown" };
  }
  const tone = status
    .toLowerCase()
    .replace(ENTRY_NODE_STATUS_SEPARATOR_PATTERN, "-");
  return { label: titleCaseStatus(tone), tone };
}

function titleCaseStatus(status: string): string {
  return status
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
