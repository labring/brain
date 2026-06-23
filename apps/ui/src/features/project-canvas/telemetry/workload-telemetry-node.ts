import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import type { DatabaseNodeStates } from "@workspace/ui/components/database-node/database-node";
import type { CanvasDatabaseWorkloadRef } from "../nodes/types";
import type {
  WorkloadTelemetrySnapshotState,
  WorkloadTelemetryTarget,
} from "./workload-telemetry-store";

type SnapshotMetrics = NonNullable<
  WorkloadTelemetrySnapshotState["item"]
>["metrics"];

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function databaseMetricsFromSnapshot(
  metrics: SnapshotMetrics
): DatabaseNodeStates["metrics"] {
  const nextMetrics: DatabaseNodeStates["metrics"] = {};
  if (metrics?.cpu !== undefined) {
    nextMetrics.cpu = metrics.cpu.value;
  }
  if (metrics?.memory !== undefined) {
    nextMetrics.memory = metrics.memory.value;
  }
  if (metrics?.storage !== undefined) {
    nextMetrics.storage = metrics.storage.value;
  }
  return nextMetrics;
}

function containerMetricsFromSnapshot(
  metrics: SnapshotMetrics
): ContainerNodeStates["metrics"] {
  const nextMetrics: ContainerNodeStates["metrics"] = {};
  if (metrics?.cpu !== undefined) {
    nextMetrics.cpu = metrics.cpu.value;
  }
  if (metrics?.memory !== undefined) {
    nextMetrics.memory = metrics.memory.value;
  }
  return nextMetrics;
}

export function containerTelemetryTargetFromStates(
  states: Pick<ContainerNodeStates, "name" | "namespace">
): WorkloadTelemetryTarget | null {
  const namespace = nonEmpty(states.namespace);
  const name = nonEmpty(states.name);
  if (namespace === undefined || name === undefined) {
    return null;
  }
  return { kind: "ap", name, namespace };
}

export function databaseTelemetryTargetFromWorkload(
  workload: CanvasDatabaseWorkloadRef
): WorkloadTelemetryTarget | null {
  const namespace = nonEmpty(workload.namespace);
  const name = nonEmpty(workload.name);
  if (namespace === undefined || name === undefined) {
    return null;
  }
  return { kind: "db", name, namespace };
}

export function containerMetricsWithTelemetrySnapshot(
  fallbackMetrics: ContainerNodeStates["metrics"],
  snapshot: WorkloadTelemetrySnapshotState
): ContainerNodeStates["metrics"] {
  const metrics = snapshot.item?.metrics;
  if (metrics === undefined) {
    return fallbackMetrics;
  }
  return {
    ...fallbackMetrics,
    ...containerMetricsFromSnapshot(metrics),
  };
}

export function databaseMetricsWithTelemetrySnapshot(
  fallbackMetrics: DatabaseNodeStates["metrics"],
  snapshot: WorkloadTelemetrySnapshotState
): DatabaseNodeStates["metrics"] {
  const metrics = snapshot.item?.metrics;
  if (metrics === undefined) {
    return fallbackMetrics;
  }
  return {
    ...fallbackMetrics,
    ...databaseMetricsFromSnapshot(metrics),
  };
}
