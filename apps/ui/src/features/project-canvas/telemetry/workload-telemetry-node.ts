import type { CanvasSelectedNode } from "@workspace/ui/components/canvas/canvas.types";
import type { ContainerNodeStates } from "@workspace/ui/components/container-node/container-node";
import type { DatabaseNodeStates } from "@workspace/ui/components/database-node/database-node";
import type { Node } from "@xyflow/react";

import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
} from "../nodes/constants";
import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
  CanvasDatabaseWorkloadRef,
} from "../nodes/types";
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

export function containerStatesWithTelemetry(
  states: ContainerNodeStates,
  snapshot: WorkloadTelemetrySnapshotState
): ContainerNodeStates {
  const metrics = snapshot.item?.metrics;
  if (metrics === undefined) {
    return states;
  }
  return {
    ...states,
    metrics: containerMetricsFromSnapshot(metrics),
  };
}

export function databaseStatesWithTelemetry(
  states: DatabaseNodeStates,
  snapshot: WorkloadTelemetrySnapshotState
): DatabaseNodeStates {
  const metrics = snapshot.item?.metrics;
  if (metrics === undefined) {
    return states;
  }
  return {
    ...states,
    metrics: databaseMetricsFromSnapshot(metrics),
  };
}

export function telemetryTargetFromCanvasNode(
  node: CanvasSelectedNode | Node | null
): WorkloadTelemetryTarget | null {
  if (node === null) {
    return null;
  }
  if (node.type === CANVAS_CONTAINER_NODE_TYPE) {
    const data = node.data as CanvasContainerNodeData;
    return containerTelemetryTargetFromStates(data.states);
  }
  if (node.type === CANVAS_DATABASE_NODE_TYPE) {
    const data = node.data as CanvasDatabaseNodeData;
    return databaseTelemetryTargetFromWorkload(data.workload);
  }
  return null;
}
