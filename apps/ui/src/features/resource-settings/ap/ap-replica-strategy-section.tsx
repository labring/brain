"use client";

import { ResourceSettingsInset } from "@workspace/ui/components/resource-settings/resource-settings";
import { SettingsSlider } from "@workspace/ui/components/settings-slider/settings-slider";
import { clampScale } from "@workspace/ui/components/settings-slider/settings-slider.utils";
import {
  SlidingToggle,
  type SlidingToggleOption,
} from "@workspace/ui/components/sliding-toggle";
import { Cpu, MemoryStick } from "lucide-react";
import type { ReactNode } from "react";
import type { ApSettingsControlledQuotaProps } from "./ap-settings-model";

export const CPU_QUOTA_DIRTY_EPS = 1e-9;
export const REPLICA_LIMITS = { max: 20, min: 1 } as const;
const CPU_UTILIZATION_TARGET_LIMITS = { max: 100, min: 1 } as const;
const MEMORY_AVERAGE_TARGET_LIMITS = { max: 8192, min: 128 } as const;
const DEFAULT_CPU_UTILIZATION_TARGET_PERCENT = 80;
const DEFAULT_MEMORY_AVERAGE_TARGET_MIB = 512;
const MEMORY_AVERAGE_VALUE_RE = /^([1-9][0-9]*)(Mi|Gi)$/;

export interface ApFixedReplicaStrategy {
  elastic?: ApElasticReplicaSettings;
  fixed: {
    replicas: number;
  };
  type: "fixed";
}

export interface ApCpuElasticReplicaTarget {
  metric: "cpu";
  type: "utilization";
  utilizationPercent: number;
}

export interface ApMemoryElasticReplicaTarget {
  averageValue: string;
  metric: "memory";
  type: "averageValue";
}

export type ApElasticReplicaTarget =
  | ApCpuElasticReplicaTarget
  | ApMemoryElasticReplicaTarget;

export interface ApElasticReplicaSettings {
  maxReplicas: number;
  minReplicas: number;
  target: ApElasticReplicaTarget;
}

export interface ApElasticReplicaStrategy {
  elastic: ApElasticReplicaSettings;
  fixed: {
    replicas: number;
  };
  type: "elastic";
}

export type ApReplicaStrategy =
  | ApElasticReplicaStrategy
  | ApFixedReplicaStrategy;

export type ReplicaStrategyType = ApReplicaStrategy["type"];
export type ElasticTargetMetric = ApElasticReplicaTarget["metric"];

const REPLICA_STRATEGY_TOGGLE_OPTIONS = [
  {
    ariaLabel: "Fixed Replicas",
    label: "Fixed Replicas",
    value: "fixed",
  },
  {
    ariaLabel: "Elastic Scaling",
    label: "Elastic Scaling",
    value: "elastic",
  },
] as const satisfies readonly SlidingToggleOption<ReplicaStrategyType>[];

const SCALING_TARGET_TOGGLE_OPTIONS = [
  {
    ariaLabel: "CPU utilization target",
    label: (
      <span className="inline-flex items-center gap-2">
        <Cpu aria-hidden className="size-4" />
        Target CPU
      </span>
    ),
    value: "cpu",
  },
  {
    ariaLabel: "Memory average target",
    label: (
      <span className="inline-flex items-center gap-2">
        <MemoryStick aria-hidden className="size-4" />
        Target Memory
      </span>
    ),
    value: "memory",
  },
] as const satisfies readonly SlidingToggleOption<ElasticTargetMetric>[];

interface ResourceQuotasDirtyReplicaStrategy {
  committed: ApReplicaStrategy;
  draft: ApReplicaStrategy;
}

interface ResourceQuotaReplicaPatch {
  replicaStrategy?: ApReplicaStrategy;
}

export const DEFAULT_FIXED_REPLICAS: number = REPLICA_LIMITS.min;
const DEFAULT_ELASTIC_REPLICA_SETTINGS: ApElasticReplicaSettings = {
  maxReplicas: 10,
  minReplicas: REPLICA_LIMITS.min,
  target: {
    metric: "cpu",
    type: "utilization",
    utilizationPercent: DEFAULT_CPU_UTILIZATION_TARGET_PERCENT,
  },
};

function roundAndClamp(n: number, min: number, max: number): number {
  return clampScale(Math.round(n), min, max);
}

export function normalizeReplicaCount(replicas: number): number {
  return roundAndClamp(replicas, REPLICA_LIMITS.min, REPLICA_LIMITS.max);
}

function normalizeCpuUtilizationTarget(utilizationPercent: number): number {
  return roundAndClamp(
    utilizationPercent,
    CPU_UTILIZATION_TARGET_LIMITS.min,
    CPU_UTILIZATION_TARGET_LIMITS.max
  );
}

function memoryAverageValueToMib(averageValue: string | undefined): number {
  const match = MEMORY_AVERAGE_VALUE_RE.exec(averageValue ?? "");
  if (match == null) {
    return DEFAULT_MEMORY_AVERAGE_TARGET_MIB;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return DEFAULT_MEMORY_AVERAGE_TARGET_MIB;
  }
  return match[2] === "Gi" ? value * 1024 : value;
}

export function memoryAverageMibToValue(mib: number): string {
  return `${roundAndClamp(
    mib,
    MEMORY_AVERAGE_TARGET_LIMITS.min,
    MEMORY_AVERAGE_TARGET_LIMITS.max
  )}Mi`;
}

function normalizeMemoryAverageTarget(
  averageValue: string | undefined
): string {
  return memoryAverageMibToValue(memoryAverageValueToMib(averageValue));
}

export function cpuElasticTarget(
  utilizationPercent = DEFAULT_CPU_UTILIZATION_TARGET_PERCENT
): ApCpuElasticReplicaTarget {
  return {
    metric: "cpu",
    type: "utilization",
    utilizationPercent: normalizeCpuUtilizationTarget(utilizationPercent),
  };
}

export function memoryElasticTarget(
  averageValue = `${DEFAULT_MEMORY_AVERAGE_TARGET_MIB}Mi`
): ApMemoryElasticReplicaTarget {
  return {
    averageValue: normalizeMemoryAverageTarget(averageValue),
    metric: "memory",
    type: "averageValue",
  };
}

export function defaultElasticTargetForMetric(
  metric: ElasticTargetMetric
): ApElasticReplicaTarget {
  if (metric === "memory") {
    return memoryElasticTarget();
  }
  return cpuElasticTarget();
}

function normalizeElasticTarget(
  target: ApElasticReplicaSettings["target"] | undefined
): ApElasticReplicaTarget {
  if (target?.metric === "memory") {
    return memoryElasticTarget(target.averageValue);
  }
  return cpuElasticTarget(target?.utilizationPercent);
}

export function normalizeFixedReplicaSettings(replicas: number): {
  replicas: number;
} {
  return { replicas: normalizeReplicaCount(replicas) };
}

export function normalizeElasticReplicaSettings(
  settings: ApElasticReplicaSettings | undefined
): ApElasticReplicaSettings {
  const minReplicas = normalizeReplicaCount(
    settings?.minReplicas ?? DEFAULT_ELASTIC_REPLICA_SETTINGS.minReplicas
  );
  const maxReplicas = Math.max(
    minReplicas,
    normalizeReplicaCount(
      settings?.maxReplicas ?? DEFAULT_ELASTIC_REPLICA_SETTINGS.maxReplicas
    )
  );
  return {
    maxReplicas,
    minReplicas,
    target: normalizeElasticTarget(settings?.target),
  };
}

export function normalizeReplicaStrategy(
  strategy: ApReplicaStrategy | undefined,
  fixedReplicas = DEFAULT_FIXED_REPLICAS
): ApReplicaStrategy {
  const fixed = normalizeFixedReplicaSettings(
    strategy?.fixed.replicas ?? fixedReplicas
  );
  if (strategy?.type === "elastic") {
    return {
      elastic: normalizeElasticReplicaSettings(strategy.elastic),
      fixed,
      type: "elastic",
    };
  }
  return {
    ...(strategy?.elastic == null
      ? {}
      : { elastic: normalizeElasticReplicaSettings(strategy.elastic) }),
    fixed,
    type: "fixed",
  };
}

export function elasticSettingsFromStrategy(
  strategy: ApReplicaStrategy
): ApElasticReplicaSettings {
  if (strategy.type === "elastic") {
    return strategy.elastic;
  }
  return strategy.elastic ?? DEFAULT_ELASTIC_REPLICA_SETTINGS;
}

export function replicaStrategiesEqual(
  a: ApReplicaStrategy,
  b: ApReplicaStrategy
): boolean {
  if (a.type !== b.type) {
    return false;
  }
  if (Math.round(a.fixed.replicas) !== Math.round(b.fixed.replicas)) {
    return false;
  }
  const aElastic = elasticSettingsFromStrategy(a);
  const bElastic = elasticSettingsFromStrategy(b);
  return (
    Math.round(aElastic.minReplicas) === Math.round(bElastic.minReplicas) &&
    Math.round(aElastic.maxReplicas) === Math.round(bElastic.maxReplicas) &&
    elasticTargetsEqual(aElastic.target, bElastic.target)
  );
}

function elasticTargetsEqual(
  a: ApElasticReplicaTarget,
  b: ApElasticReplicaTarget
): boolean {
  if (a.metric !== b.metric) {
    return false;
  }

  if (a.metric === "memory") {
    return (
      b.metric === "memory" &&
      normalizeMemoryAverageTarget(a.averageValue) ===
        normalizeMemoryAverageTarget(b.averageValue)
    );
  }

  if (a.metric === "cpu") {
    return (
      b.metric === "cpu" &&
      Math.round(a.utilizationPercent) === Math.round(b.utilizationPercent)
    );
  }

  return false;
}

export function replicaStrategyWithType(
  current: ApReplicaStrategy,
  type: ReplicaStrategyType
): ApReplicaStrategy {
  const elastic = normalizeElasticReplicaSettings(
    elasticSettingsFromStrategy(current)
  );
  const fixed = normalizeFixedReplicaSettings(current.fixed.replicas);
  if (type === "elastic") {
    return { elastic, fixed, type: "elastic" };
  }
  return { elastic, fixed, type: "fixed" };
}

export function resourceQuotaReplicaPatchFromDraft(
  hasReplicasQuota: boolean,
  draftReplicaStrategy: ApReplicaStrategy
): ResourceQuotaReplicaPatch {
  if (!hasReplicasQuota) {
    return {};
  }
  return { replicaStrategy: draftReplicaStrategy };
}

export function resourceQuotasDirty(
  draftCpu: number,
  draftMem: number,
  committedCpu: number,
  committedMem: number,
  replicaStrategy?: ResourceQuotasDirtyReplicaStrategy
): boolean {
  const cpuMemDirty =
    Math.abs(draftCpu - committedCpu) > CPU_QUOTA_DIRTY_EPS ||
    Math.round(draftMem) !== Math.round(committedMem);
  if (replicaStrategy == null) {
    return cpuMemDirty;
  }
  return (
    cpuMemDirty ||
    !replicaStrategiesEqual(replicaStrategy.draft, replicaStrategy.committed)
  );
}

export function formatPlainNumber(
  value: number,
  maximumFractionDigits: number
) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

export function cpuCoresValueSuffix(cores: number) {
  const rounded = Number(cores.toFixed(2));
  return rounded === 1 ? " Core" : " Cores";
}

export function formatMemoryMibValue(mib: number) {
  const rounded = Math.round(mib);
  if (Math.abs(rounded) >= 1024) {
    return `${formatPlainNumber(rounded / 1024, 2)} Gi`;
  }
  return `${formatPlainNumber(rounded, 0)} Mi`;
}

export function memoryMibDisplayValue(mib: number) {
  const rounded = Math.round(mib);
  if (Math.abs(rounded) >= 1024) {
    return rounded / 1024;
  }
  return rounded;
}

export function memoryMibValueSuffix(mib: number) {
  return Math.abs(Math.round(mib)) >= 1024 ? " Gi" : " Mi";
}

function formatReplicaValue(replicas: number) {
  const rounded = Math.round(replicas);
  return formatPlainNumber(rounded, 0);
}

interface ReplicaStrategyContentProps {
  elastic: ApElasticReplicaSettings;
  fixedReplicasSliderParts: {
    onReplicasQuotaChange: (value: number) => void;
    replicasValue: number;
    rest: Omit<ApSettingsControlledQuotaProps, "onValueChange" | "value">;
  };
  onElasticCpuTargetChange: (value: number) => void;
  onElasticMaxReplicasChange: (value: number) => void;
  onElasticMemoryTargetChange: (value: number) => void;
  onElasticMinReplicasChange: (value: number) => void;
  onElasticTargetMetricChange: (metric: ElasticTargetMetric) => void;
  onStrategyTypeChange: (type: ReplicaStrategyType) => void;
  readOnly: boolean;
  strategyType: ReplicaStrategyType;
}

interface ReadOnlyReplicaValueProps {
  label: string;
  value: ReactNode;
}

function ReadOnlyReplicaValue({ label, value }: ReadOnlyReplicaValueProps) {
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-border bg-white/5 px-2.5 py-2">
      <span className="min-w-0 truncate text-muted-foreground text-xs">
        {label}
      </span>
      <span className="shrink-0 font-medium text-foreground text-xs tabular-nums">
        {value}
      </span>
    </div>
  );
}

function replicaStrategyDisplayName(strategyType: ReplicaStrategyType): string {
  if (strategyType === "elastic") {
    return "Elastic Scaling";
  }
  return "Fixed Replicas";
}

function elasticTargetMetricDisplayName(
  targetMetric: ElasticTargetMetric
): string {
  if (targetMetric === "memory") {
    return "Memory";
  }
  return "CPU";
}

function memoryTargetDisplayValue(
  elastic: ApElasticReplicaSettings,
  memoryTargetMib: number
): string {
  if (elastic.target.metric === "memory") {
    return formatMemoryMibValue(
      memoryAverageValueToMib(elastic.target.averageValue)
    );
  }
  return formatMemoryMibValue(memoryTargetMib);
}

interface ReadOnlyReplicaStrategyRowsOptions {
  cpuTargetPercent: number;
  elastic: ApElasticReplicaSettings;
  fixedReplicas: number;
  maxReplicas: number;
  memoryTargetMib: number;
  minReplicas: number;
  strategyType: ReplicaStrategyType;
  targetMetric: ElasticTargetMetric;
}

function readOnlyReplicaStrategyRows({
  cpuTargetPercent,
  elastic,
  fixedReplicas,
  maxReplicas,
  memoryTargetMib,
  minReplicas,
  strategyType,
  targetMetric,
}: ReadOnlyReplicaStrategyRowsOptions): ReadOnlyReplicaValueProps[] {
  const rows: ReadOnlyReplicaValueProps[] = [
    {
      label: "Strategy",
      value: replicaStrategyDisplayName(strategyType),
    },
  ];

  if (strategyType === "fixed") {
    rows.push({
      label: "Number of Replicas",
      value: formatReplicaValue(fixedReplicas),
    });
    return rows;
  }

  rows.push(
    { label: "Minimum Replicas", value: formatReplicaValue(minReplicas) },
    { label: "Maximum Replicas", value: formatReplicaValue(maxReplicas) },
    {
      label: "Scaling target",
      value: elasticTargetMetricDisplayName(targetMetric),
    }
  );

  if (targetMetric === "memory") {
    rows.push({
      label: "Memory average target",
      value: memoryTargetDisplayValue(elastic, memoryTargetMib),
    });
    return rows;
  }

  rows.push({
    label: "CPU utilization target",
    value: `${cpuTargetPercent}%`,
  });
  return rows;
}

interface ReadOnlyReplicaStrategyContentProps {
  rows: readonly ReadOnlyReplicaValueProps[];
}

function ReadOnlyReplicaStrategyContent({
  rows,
}: ReadOnlyReplicaStrategyContentProps) {
  return (
    <div className="grid min-w-0 gap-2">
      {rows.map((row) => (
        <ReadOnlyReplicaValue
          key={row.label}
          label={row.label}
          value={row.value}
        />
      ))}
    </div>
  );
}

function ScalingTargetSlider({
  cpuTargetPercent,
  disabled,
  memoryTargetMib,
  onCpuTargetChange,
  onMemoryTargetChange,
  targetMetric,
}: {
  cpuTargetPercent: number;
  disabled: boolean;
  memoryTargetMib: number;
  onCpuTargetChange: (value: number) => void;
  onMemoryTargetChange: (value: number) => void;
  targetMetric: ElasticTargetMetric;
}) {
  const config =
    targetMetric === "memory"
      ? {
          ariaLabel: "Memory average target",
          displayValue: memoryMibDisplayValue(memoryTargetMib),
          format: formatMemoryMibValue,
          label: "Target Memory",
          max: MEMORY_AVERAGE_TARGET_LIMITS.max,
          maxDecimals: 2,
          min: MEMORY_AVERAGE_TARGET_LIMITS.min,
          onChange: onMemoryTargetChange,
          value: memoryTargetMib,
          valueSuffix: memoryMibValueSuffix(memoryTargetMib),
        }
      : {
          ariaLabel: "CPU utilization target",
          displayValue: cpuTargetPercent,
          format: (next: number) => `${formatPlainNumber(next, 0)}%`,
          label: "Target CPU",
          max: CPU_UTILIZATION_TARGET_LIMITS.max,
          maxDecimals: 0,
          min: CPU_UTILIZATION_TARGET_LIMITS.min,
          onChange: onCpuTargetChange,
          value: cpuTargetPercent,
          valueSuffix: "%",
        };

  return (
    <ResourceSettingsInset>
      <SettingsSlider
        ariaLabel={config.ariaLabel}
        disabled={disabled}
        displayValue={config.displayValue}
        formatBound={config.format}
        label={config.label}
        max={config.max}
        maxDecimals={config.maxDecimals}
        min={config.min}
        onValueChange={config.onChange}
        step={1}
        value={config.value}
        valueSuffix={config.valueSuffix}
      />
    </ResourceSettingsInset>
  );
}

export function ReplicaStrategyContent({
  elastic,
  fixedReplicasSliderParts,
  onElasticCpuTargetChange,
  onElasticMaxReplicasChange,
  onElasticMemoryTargetChange,
  onElasticMinReplicasChange,
  onElasticTargetMetricChange,
  onStrategyTypeChange,
  readOnly,
  strategyType,
}: ReplicaStrategyContentProps) {
  const minReplicas = normalizeReplicaCount(elastic.minReplicas);
  const maxReplicas = Math.max(
    minReplicas,
    normalizeReplicaCount(elastic.maxReplicas)
  );
  const targetMetric = elastic.target.metric;
  const cpuTargetPercent =
    elastic.target.metric === "cpu"
      ? normalizeCpuUtilizationTarget(elastic.target.utilizationPercent)
      : DEFAULT_CPU_UTILIZATION_TARGET_PERCENT;
  const memoryTargetMib =
    elastic.target.metric === "memory"
      ? memoryAverageValueToMib(elastic.target.averageValue)
      : DEFAULT_MEMORY_AVERAGE_TARGET_MIB;

  const readOnlyRows = readOnlyReplicaStrategyRows({
    cpuTargetPercent,
    elastic,
    fixedReplicas: fixedReplicasSliderParts.replicasValue,
    maxReplicas,
    memoryTargetMib,
    minReplicas,
    strategyType,
    targetMetric,
  });

  if (readOnly) {
    return <ReadOnlyReplicaStrategyContent rows={readOnlyRows} />;
  }

  return (
    <div className="grid min-w-0 gap-3">
      <SlidingToggle
        ariaLabel="Replica Strategy"
        disabled={readOnly}
        onValueChange={onStrategyTypeChange}
        options={REPLICA_STRATEGY_TOGGLE_OPTIONS}
        value={strategyType}
      />

      {strategyType === "fixed" ? (
        <ResourceSettingsInset>
          <SettingsSlider
            ariaLabel="Replica count"
            disabled={readOnly || fixedReplicasSliderParts.rest.disabled}
            formatBound={formatReplicaValue}
            label="Number of Replicas"
            max={fixedReplicasSliderParts.rest.max ?? REPLICA_LIMITS.max}
            maxDecimals={0}
            min={fixedReplicasSliderParts.rest.min ?? REPLICA_LIMITS.min}
            onValueChange={fixedReplicasSliderParts.onReplicasQuotaChange}
            step={fixedReplicasSliderParts.rest.step ?? 1}
            value={fixedReplicasSliderParts.replicasValue}
          />
        </ResourceSettingsInset>
      ) : (
        <div className="flex flex-col gap-3">
          <ResourceSettingsInset>
            <SettingsSlider
              ariaLabel="Minimum Replicas"
              disabled={readOnly}
              formatBound={formatReplicaValue}
              label="Minimum Replicas"
              max={REPLICA_LIMITS.max}
              maxDecimals={0}
              min={REPLICA_LIMITS.min}
              onValueChange={onElasticMinReplicasChange}
              step={1}
              value={minReplicas}
            />
          </ResourceSettingsInset>

          <ResourceSettingsInset>
            <SettingsSlider
              ariaLabel="Maximum Replicas"
              disabled={readOnly}
              formatBound={formatReplicaValue}
              label="Maximum Replicas"
              max={REPLICA_LIMITS.max}
              maxDecimals={0}
              min={REPLICA_LIMITS.min}
              onValueChange={onElasticMaxReplicasChange}
              step={1}
              value={maxReplicas}
            />
          </ResourceSettingsInset>

          <SlidingToggle
            ariaLabel="Scaling target"
            disabled={readOnly}
            indicatorClassName="dark:bg-input/30"
            onValueChange={onElasticTargetMetricChange}
            options={SCALING_TARGET_TOGGLE_OPTIONS}
            value={targetMetric}
          />

          <ScalingTargetSlider
            cpuTargetPercent={cpuTargetPercent}
            disabled={readOnly}
            memoryTargetMib={memoryTargetMib}
            onCpuTargetChange={onElasticCpuTargetChange}
            onMemoryTargetChange={onElasticMemoryTargetChange}
            targetMetric={targetMetric}
          />
        </div>
      )}
    </div>
  );
}
