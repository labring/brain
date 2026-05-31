import type { WorkloadTelemetrySeriesTarget } from "@workspace/api/hooks";
import type { Node } from "@xyflow/react";

import {
  containerStatesFromNode,
  telemetryKindFromWorkload,
  workloadClaimKindFromStates,
} from "@/features/project-canvas/flow/container-node-workload";
import { databaseNodeDataFromNode } from "@/features/project-canvas/nodes/database-node-data";

export const METRICS_SERIES_RANGE_MS = 60 * 60 * 1000;
export const METRICS_SERIES_STEP_SECONDS = 60;

type MetricsPanelNode = Node | null;

export function workloadMetricsSeriesWindow(now = new Date()) {
  return {
    end: now,
    start: new Date(now.getTime() - METRICS_SERIES_RANGE_MS),
    stepSeconds: METRICS_SERIES_STEP_SECONDS,
  };
}

export function workloadMetricsSeriesTarget(
  node: MetricsPanelNode,
  namespace: string
): WorkloadTelemetrySeriesTarget | null {
  if (node === null) {
    return null;
  }
  const states = containerStatesFromNode(node);
  const workloadKind = workloadClaimKindFromStates(states);
  return metricsSeriesTarget({
    kind: telemetryKindFromWorkload(workloadKind),
    name: states?.name,
    namespace: states?.namespace?.trim() || namespace,
  });
}

export function databaseMetricsSeriesTarget(
  node: MetricsPanelNode,
  open: boolean
): WorkloadTelemetrySeriesTarget | null {
  if (!open) {
    return null;
  }
  const data = databaseNodeDataFromNode(node);
  return metricsSeriesTarget({
    kind: "db",
    name: data?.workload.name,
    namespace: data?.workload.namespace,
  });
}

function metricsSeriesTarget(options: {
  kind: WorkloadTelemetrySeriesTarget["kind"];
  name: string | undefined;
  namespace: string | undefined;
}): WorkloadTelemetrySeriesTarget | null {
  const name = options.name?.trim() ?? "";
  const namespace = options.namespace?.trim() ?? "";
  if (name === "" || namespace === "") {
    return null;
  }
  return { kind: options.kind, name, namespace };
}
