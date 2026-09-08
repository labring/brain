import type {
  WorkloadTelemetrySnapshotKind,
  WorkloadTelemetrySnapshotMetric,
  WorkloadTelemetrySnapshotResponse,
} from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import type { Edge, Node } from "@xyflow/react";

import {
  readApImage,
  readApIsPaused,
  readApReplicas,
} from "@/features/resource-settings/ap/k8s/ap-spec-access";
import { dbResourceToSettingsData } from "@/features/resource-settings/db/db-settings-resource";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
} from "../nodes/constants";
import type { CanvasDatabaseNodeData } from "../nodes/types";

const FALLBACK_COLUMNS = 3;
const FALLBACK_COL_GAP = 340;
const FALLBACK_ROW_GAP = 280;

function fallbackCanvasPosition(index: number): { x: number; y: number } {
  return {
    x: (index % FALLBACK_COLUMNS) * FALLBACK_COL_GAP,
    y: Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_ROW_GAP,
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
