import {
  buildDbPublicAccessMergePatch,
  type DbPublicAccessPatchOptions,
} from "@workspace/api/lib/db-public-access-patch";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";

export interface DatabaseSettingsNumberConstraint {
  max: number;
  min: number;
  step: number;
}

export const DB_SETTINGS_REPLICAS = { max: 10, min: 1 } as const;
export const DB_SETTINGS_REPLICA_COUNT = {
  ...DB_SETTINGS_REPLICAS,
  step: 1,
} as const satisfies DatabaseSettingsNumberConstraint;
export const DB_SETTINGS_CPU_LIMIT_CORES = {
  max: 4,
  min: 0.25,
  step: 0.25,
} as const satisfies DatabaseSettingsNumberConstraint;
export const DB_SETTINGS_MEMORY_LIMIT_GIB = {
  max: 8,
  min: 0.5,
  step: 0.5,
} as const satisfies DatabaseSettingsNumberConstraint;
export const DB_SETTINGS_STORAGE_GIB = {
  max: 100,
  min: 1,
  step: 1,
} as const satisfies DatabaseSettingsNumberConstraint;

const DB_SETTINGS_DEFAULTS = {
  cpuLimitCores: 0.5,
  exposeNodePort: false,
  memoryLimitGi: 1,
  replicas: DB_SETTINGS_REPLICAS.min,
  storageSizeGi: 3,
} as const;

const CPU_MILLICORE_PATTERN = /^([0-9]+(?:\.[0-9]+)?)m$/i;
const BINARY_QUANTITY_PATTERN = /^([0-9]+(?:\.[0-9]+)?)(Ki|Mi|Gi|Ti)?$/i;

export interface DatabaseSettingsDraft {
  cpuLimitCores: number;
  exposeNodePort: boolean;
  memoryLimitGi: number;
  replicas: number;
  storageSizeGi: number;
}

export interface DatabaseSettingsPatch {
  metadata?: {
    labels: {
      region: string;
    };
  };
  spec?: Partial<{
    cpuLimit: string;
    exposeNodePort: boolean;
    memoryLimit: string;
    replicas: number;
    storageSize: string;
  }>;
}

function integerInRange(raw: unknown, fallback: number): number {
  const numeric = finiteNumberFromRaw(raw);
  if (numeric === undefined) {
    return fallback;
  }
  const rounded = Math.round(numeric);
  return Math.min(
    DB_SETTINGS_REPLICAS.max,
    Math.max(DB_SETTINGS_REPLICAS.min, rounded)
  );
}

function finiteNumberFromRaw(raw: unknown): number | undefined {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
}

function steppedNumberInRange(
  raw: unknown,
  constraint: DatabaseSettingsNumberConstraint,
  fallback: number
): number {
  const numeric = finiteNumberFromRaw(raw);
  if (numeric === undefined) {
    return fallback;
  }
  const clamped = Math.min(constraint.max, Math.max(constraint.min, numeric));
  const stepped =
    Math.round((clamped - constraint.min) / constraint.step) * constraint.step +
    constraint.min;
  return Number(stepped.toFixed(3));
}

function parseCpuCores(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  const trimmed = raw.trim();
  const millicores = CPU_MILLICORE_PATTERN.exec(trimmed);
  if (millicores?.[1] !== undefined) {
    const numeric = Number(millicores[1]);
    return Number.isFinite(numeric) ? numeric / 1000 : undefined;
  }
  const cores = Number(trimmed);
  return Number.isFinite(cores) ? cores : undefined;
}

function parseBinaryQuantityToGi(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw !== "string" || raw.trim() === "") {
    return undefined;
  }
  const match = BINARY_QUANTITY_PATTERN.exec(raw.trim());
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  switch (match[2]?.toLowerCase()) {
    case "ki":
      return value / (1024 * 1024);
    case "mi":
      return value / 1024;
    case "ti":
      return value * 1024;
    case "gi":
    case undefined:
      return value;
    default:
      return undefined;
  }
}

export function normalizeDbSettingsReplicas(raw: unknown): number {
  return integerInRange(raw, DB_SETTINGS_REPLICAS.min);
}

export function normalizeDbSettingsCpuLimitCores(raw: unknown): number {
  return steppedNumberInRange(
    parseCpuCores(raw),
    DB_SETTINGS_CPU_LIMIT_CORES,
    DB_SETTINGS_DEFAULTS.cpuLimitCores
  );
}

export function normalizeDbSettingsMemoryLimitGi(raw: unknown): number {
  return steppedNumberInRange(
    parseBinaryQuantityToGi(raw),
    DB_SETTINGS_MEMORY_LIMIT_GIB,
    DB_SETTINGS_DEFAULTS.memoryLimitGi
  );
}

export function normalizeDbSettingsStorageGi(raw: unknown): number {
  return steppedNumberInRange(
    parseBinaryQuantityToGi(raw),
    DB_SETTINGS_STORAGE_GIB,
    DB_SETTINGS_DEFAULTS.storageSizeGi
  );
}

function normalizeDbSettingsExposeNodePort(raw: unknown): boolean {
  return typeof raw === "boolean" ? raw : DB_SETTINGS_DEFAULTS.exposeNodePort;
}

export function dbSettingsCpuLimitQuantity(cores: number): string {
  const normalized = normalizeDbSettingsCpuLimitCores(cores);
  const millicores = Math.round(normalized * 1000);
  if (millicores % 1000 === 0) {
    return String(millicores / 1000);
  }
  return `${millicores}m`;
}

export function dbSettingsMemoryLimitQuantity(memoryGi: number): string {
  const normalized = normalizeDbSettingsMemoryLimitGi(memoryGi);
  if (Number.isInteger(normalized)) {
    return `${normalized}Gi`;
  }
  return `${Math.round(normalized * 1024)}Mi`;
}

export function dbSettingsStorageQuantity(storageGi: number): string {
  return `${normalizeDbSettingsStorageGi(storageGi)}Gi`;
}

function normalizeDraft(draft: DatabaseSettingsDraft): DatabaseSettingsDraft {
  return {
    cpuLimitCores: normalizeDbSettingsCpuLimitCores(draft.cpuLimitCores),
    exposeNodePort: normalizeDbSettingsExposeNodePort(draft.exposeNodePort),
    memoryLimitGi: normalizeDbSettingsMemoryLimitGi(draft.memoryLimitGi),
    replicas: normalizeDbSettingsReplicas(draft.replicas),
    storageSizeGi: normalizeDbSettingsStorageGi(draft.storageSizeGi),
  };
}

export function dbSettingsDraftFromNodeData({
  desired,
}: Pick<CanvasDatabaseNodeData, "desired">): DatabaseSettingsDraft {
  return {
    cpuLimitCores: normalizeDbSettingsCpuLimitCores(desired?.cpuLimit),
    exposeNodePort: normalizeDbSettingsExposeNodePort(desired?.exposeNodePort),
    memoryLimitGi: normalizeDbSettingsMemoryLimitGi(desired?.memoryLimit),
    replicas: normalizeDbSettingsReplicas(desired?.replicas),
    storageSizeGi: normalizeDbSettingsStorageGi(desired?.storageSize),
  };
}

export function dbSettingsDraftIsDirty(
  original: DatabaseSettingsDraft,
  draft: DatabaseSettingsDraft
): boolean {
  const normalizedOriginal = normalizeDraft(original);
  const normalizedDraft = normalizeDraft(draft);
  return (
    normalizedOriginal.cpuLimitCores !== normalizedDraft.cpuLimitCores ||
    normalizedOriginal.exposeNodePort !== normalizedDraft.exposeNodePort ||
    normalizedOriginal.memoryLimitGi !== normalizedDraft.memoryLimitGi ||
    normalizedOriginal.replicas !== normalizedDraft.replicas ||
    normalizedOriginal.storageSizeGi !== normalizedDraft.storageSizeGi
  );
}

export function buildDbSettingsPatch(
  original: DatabaseSettingsDraft,
  draft: DatabaseSettingsDraft,
  options: DbPublicAccessPatchOptions = {}
): DatabaseSettingsPatch | null {
  const normalizedOriginal = normalizeDraft(original);
  const normalizedDraft = normalizeDraft(draft);
  const spec: NonNullable<DatabaseSettingsPatch["spec"]> = {};
  const publicAccessPatch = buildDbPublicAccessMergePatch(
    normalizedDraft.exposeNodePort,
    options
  );
  const metadata = publicAccessPatch.metadata;

  if (normalizedOriginal.replicas !== normalizedDraft.replicas) {
    spec.replicas = normalizedDraft.replicas;
  }
  if (normalizedOriginal.exposeNodePort !== normalizedDraft.exposeNodePort) {
    spec.exposeNodePort = publicAccessPatch.spec.exposeNodePort;
  }
  if (normalizedOriginal.cpuLimitCores !== normalizedDraft.cpuLimitCores) {
    spec.cpuLimit = dbSettingsCpuLimitQuantity(normalizedDraft.cpuLimitCores);
  }
  if (normalizedOriginal.memoryLimitGi !== normalizedDraft.memoryLimitGi) {
    spec.memoryLimit = dbSettingsMemoryLimitQuantity(
      normalizedDraft.memoryLimitGi
    );
  }
  if (normalizedOriginal.storageSizeGi !== normalizedDraft.storageSizeGi) {
    spec.storageSize = dbSettingsStorageQuantity(normalizedDraft.storageSizeGi);
  }

  if (Object.keys(spec).length === 0 && metadata === undefined) {
    return null;
  }
  return {
    ...(metadata === undefined ? {} : { metadata }),
    ...(Object.keys(spec).length === 0 ? {} : { spec }),
  };
}
