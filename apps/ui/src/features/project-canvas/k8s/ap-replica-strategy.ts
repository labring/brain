import { clampScale } from "@workspace/ui/components/scale-slider/scale-slider.utils";

export const AP_REPLICA_LIMITS = { max: 20, min: 1 } as const;
export const DEFAULT_AP_FIXED_REPLICAS = AP_REPLICA_LIMITS.min;
export const DEFAULT_AP_ELASTIC_MIN_REPLICAS = AP_REPLICA_LIMITS.min;
export const DEFAULT_AP_ELASTIC_MAX_REPLICAS = 10;
export const DEFAULT_AP_ELASTIC_CPU_UTILIZATION_PERCENT = 80;
export const DEFAULT_AP_ELASTIC_MEMORY_AVERAGE_VALUE = "512Mi";
export const AP_ELASTIC_CPU_UTILIZATION_LIMITS = { max: 100, min: 1 } as const;
const AP_ELASTIC_MEMORY_AVERAGE_VALUE_PATTERN = /^[1-9][0-9]*(Mi|Gi)$/;

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

export interface ApFixedReplicaStrategy {
  elastic?: ApElasticReplicaSettings;
  fixed: {
    replicas: number;
  };
  type: "fixed";
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

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

export function normalizeApFixedReplicas(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_AP_FIXED_REPLICAS;
  }
  const n = Math.round(raw);
  if (n <= 0) {
    return DEFAULT_AP_FIXED_REPLICAS;
  }
  return clampScale(n, AP_REPLICA_LIMITS.min, AP_REPLICA_LIMITS.max);
}

export function validateApFixedReplicas(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (
    !Number.isFinite(n) ||
    n < AP_REPLICA_LIMITS.min ||
    n > AP_REPLICA_LIMITS.max
  ) {
    throw new Error("Replicas must be between 1 and 20.");
  }
  return n;
}

export function validateApElasticReplicas(raw: unknown, label: string): number {
  const n = Math.round(Number(raw));
  if (
    !Number.isFinite(n) ||
    n < AP_REPLICA_LIMITS.min ||
    n > AP_REPLICA_LIMITS.max
  ) {
    throw new Error(`${label} must be between 1 and 20.`);
  }
  return n;
}

export function validateApElasticCpuUtilizationPercent(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (
    !Number.isFinite(n) ||
    n < AP_ELASTIC_CPU_UTILIZATION_LIMITS.min ||
    n > AP_ELASTIC_CPU_UTILIZATION_LIMITS.max
  ) {
    throw new Error("CPU utilization target must be between 1 and 100.");
  }
  return n;
}

export function validateApElasticMemoryAverageValue(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("Memory average target must be a Mi or Gi quantity.");
  }
  const value = raw.trim();
  if (!AP_ELASTIC_MEMORY_AVERAGE_VALUE_PATTERN.test(value)) {
    throw new Error("Memory average target must be a Mi or Gi quantity.");
  }
  return value;
}

function validateApElasticTarget(
  target: ApElasticReplicaTarget
): ApElasticReplicaTarget {
  if (target.metric === "memory") {
    if (target.type !== "averageValue") {
      throw new Error("Memory elastic target must use averageValue.");
    }
    return {
      averageValue: validateApElasticMemoryAverageValue(target.averageValue),
      metric: "memory",
      type: "averageValue",
    };
  }
  if (target.type !== "utilization") {
    throw new Error("CPU elastic target must use utilization.");
  }
  return {
    metric: "cpu",
    type: "utilization",
    utilizationPercent: validateApElasticCpuUtilizationPercent(
      target.utilizationPercent
    ),
  };
}

export function validateApElasticReplicaSettings(
  elastic: ApElasticReplicaSettings
): ApElasticReplicaSettings {
  const minReplicas = validateApElasticReplicas(
    elastic.minReplicas,
    "Minimum replicas"
  );
  const maxReplicas = validateApElasticReplicas(
    elastic.maxReplicas,
    "Maximum replicas"
  );
  if (minReplicas > maxReplicas) {
    throw new Error(
      "Minimum replicas must be less than or equal to maximum replicas."
    );
  }
  return {
    maxReplicas,
    minReplicas,
    target: validateApElasticTarget(elastic.target),
  };
}

function normalizeApElasticReplicas(raw: unknown, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fallback;
  }
  return clampScale(
    Math.round(raw),
    AP_REPLICA_LIMITS.min,
    AP_REPLICA_LIMITS.max
  );
}

function normalizeApElasticCpuUtilizationPercent(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return DEFAULT_AP_ELASTIC_CPU_UTILIZATION_PERCENT;
  }
  return clampScale(
    Math.round(raw),
    AP_ELASTIC_CPU_UTILIZATION_LIMITS.min,
    AP_ELASTIC_CPU_UTILIZATION_LIMITS.max
  );
}

function normalizeApElasticMemoryAverageValue(raw: unknown): string {
  if (typeof raw !== "string") {
    return DEFAULT_AP_ELASTIC_MEMORY_AVERAGE_VALUE;
  }
  const value = raw.trim();
  return AP_ELASTIC_MEMORY_AVERAGE_VALUE_PATTERN.test(value)
    ? value
    : DEFAULT_AP_ELASTIC_MEMORY_AVERAGE_VALUE;
}

function normalizeApElasticTarget(raw: unknown): ApElasticReplicaTarget {
  const target = asRecord(raw);
  if (target?.metric === "memory" && target.type === "averageValue") {
    return {
      averageValue: normalizeApElasticMemoryAverageValue(target.averageValue),
      metric: "memory",
      type: "averageValue",
    };
  }
  if (target?.metric === "cpu" && target.type === "utilization") {
    return {
      metric: "cpu",
      type: "utilization",
      utilizationPercent: normalizeApElasticCpuUtilizationPercent(
        target.utilizationPercent
      ),
    };
  }
  return {
    metric: "cpu",
    type: "utilization",
    utilizationPercent: DEFAULT_AP_ELASTIC_CPU_UTILIZATION_PERCENT,
  };
}

function normalizeApElasticReplicaSettings(
  raw: unknown
): ApElasticReplicaSettings {
  const elastic = asRecord(raw);
  const minReplicas = normalizeApElasticReplicas(
    elastic?.minReplicas,
    DEFAULT_AP_ELASTIC_MIN_REPLICAS
  );
  const maxReplicas = Math.max(
    minReplicas,
    normalizeApElasticReplicas(
      elastic?.maxReplicas,
      DEFAULT_AP_ELASTIC_MAX_REPLICAS
    )
  );
  return {
    maxReplicas,
    minReplicas,
    target: normalizeApElasticTarget(elastic?.target),
  };
}

export function canonicalFixedReplicaStrategy(
  replicas: number,
  elastic?: ApElasticReplicaSettings
): ApFixedReplicaStrategy {
  return {
    ...(elastic == null
      ? {}
      : { elastic: validateApElasticReplicaSettings(elastic) }),
    fixed: { replicas: validateApFixedReplicas(replicas) },
    type: "fixed",
  };
}

export function defaultFixedReplicaStrategy(): ApFixedReplicaStrategy {
  return {
    fixed: { replicas: DEFAULT_AP_FIXED_REPLICAS },
    type: "fixed",
  };
}

export function canonicalElasticReplicaStrategy(
  elastic: ApElasticReplicaSettings,
  fixedReplicas: number = DEFAULT_AP_FIXED_REPLICAS
): ApElasticReplicaStrategy {
  return {
    elastic: validateApElasticReplicaSettings(elastic),
    fixed: { replicas: validateApFixedReplicas(fixedReplicas) },
    type: "elastic",
  };
}

export function canonicalApReplicaStrategy(
  strategy: ApReplicaStrategy
): ApReplicaStrategy {
  if (strategy.type === "elastic") {
    return canonicalElasticReplicaStrategy(
      strategy.elastic,
      strategy.fixed.replicas
    );
  }
  return canonicalFixedReplicaStrategy(
    strategy.fixed.replicas,
    strategy.elastic
  );
}

export function apReplicaStrategyFromResource(
  resource: Record<string, unknown>
): ApReplicaStrategy {
  const replicaStrategy = asRecord(resource.replicaStrategy);
  const fixed = asRecord(replicaStrategy?.fixed);
  const fixedReplicas = normalizeApFixedReplicas(
    fixed?.replicas ?? resource.replicas
  );
  if (replicaStrategy?.type === "elastic") {
    return canonicalElasticReplicaStrategy(
      normalizeApElasticReplicaSettings(replicaStrategy.elastic),
      fixedReplicas
    );
  }
  if (replicaStrategy?.type === "fixed" && fixed != null) {
    return canonicalFixedReplicaStrategy(
      fixedReplicas,
      asRecord(replicaStrategy.elastic) == null
        ? undefined
        : normalizeApElasticReplicaSettings(replicaStrategy.elastic)
    );
  }
  return canonicalFixedReplicaStrategy(
    normalizeApFixedReplicas(resource.replicas)
  );
}

export function apFixedReplicasFromResource(
  resource: Record<string, unknown>
): number {
  return apReplicaStrategyFromResource(resource).fixed.replicas;
}
