"use client";

import { useWorkloadTelemetrySeries } from "@workspace/api/hooks";
import type { MetricDataPoint } from "@workspace/ui/components/metrics-chart/metrics-chart.types";
import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { Activity, Cpu, MemoryStick } from "lucide-react";
import { type ComponentType, memo, type SVGProps, useMemo } from "react";

import { containerStatesFromNode } from "@/features/project-canvas/flow/container-node-workload";
import { telemetryRowsToMetricsData } from "@/features/project-canvas/telemetry/rows-to-metrics";
import { kubeconfigAtom, namespaceAtom } from "@/store/auth-store";
import { CanvasResourcePane } from "./canvas-resource-pane";
import { formatPercent, latestPercent } from "./database-metrics-format";
import { MetricSeriesCard } from "./metric-series-card";
import {
  METRICS_SERIES_STEP_SECONDS,
  workloadMetricsSeriesTarget,
  workloadMetricsSeriesWindow,
} from "./metrics-series-request";

function WorkloadMetricCard({
  fallback,
  icon,
  label,
  series,
}: {
  fallback: number | string | undefined;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  series: MetricDataPoint[];
}) {
  const percent = latestPercent(series, fallback);

  return (
    <MetricSeriesCard
      icon={icon}
      label={label}
      series={series}
      topRight={
        <p className="shrink-0 text-foreground text-sm leading-5">
          {formatPercent(percent)}
        </p>
      }
    />
  );
}

export const WorkloadMetricsPane = memo(function WorkloadMetricsPane({
  node,
  onClose,
}: {
  node: Node;
  onClose: () => void;
}) {
  const kubeconfig = useAtomValue(kubeconfigAtom);
  const ns = useAtomValue(namespaceAtom).trim();
  const states = containerStatesFromNode(node);
  const name = states?.name ?? "Workload";

  const target = useMemo(
    () => workloadMetricsSeriesTarget(node, ns),
    [node, ns]
  );

  const { data: telemetrySeries } = useWorkloadTelemetrySeries({
    getWindow: workloadMetricsSeriesWindow,
    kubeconfig,
    refreshInterval: 5000,
    target,
    windowKey: `last-60m-${METRICS_SERIES_STEP_SECONDS}s`,
  });

  const metricsData = useMemo(
    () => telemetryRowsToMetricsData(telemetrySeries?.rows),
    [telemetrySeries]
  );

  return (
    <CanvasResourcePane
      bodyClassName="gap-3.5"
      closeAriaLabel="Close workload metrics"
      icon={<Activity aria-hidden className="size-4 shrink-0 text-blue-400" />}
      onClose={onClose}
      subtitle={`${states?.kind ?? "Workload"} · Last 60 minutes`}
      title={`${name} Metrics`}
    >
      <WorkloadMetricCard
        fallback={states?.metrics?.cpu}
        icon={Cpu}
        label="CPU"
        series={metricsData.cpu ?? []}
      />
      <WorkloadMetricCard
        fallback={states?.metrics?.memory}
        icon={MemoryStick}
        label="Memory"
        series={metricsData.memory ?? []}
      />
    </CanvasResourcePane>
  );
});

WorkloadMetricsPane.displayName = "WorkloadMetricsPane";
