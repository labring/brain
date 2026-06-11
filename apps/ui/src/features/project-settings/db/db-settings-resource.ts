import {
  type DeviconKey,
  deviconSrc,
  devicons,
} from "@workspace/ui/assets/devicons";
import type {
  DatabaseEngineKey,
  DatabaseNodeStates,
} from "@workspace/ui/components/database-node/database-node";
import type { DbSettingsData } from "./db-settings-types";

export interface DbSettingsMetricPercents {
  cpuPercent?: number;
  memoryPercent?: number;
  storagePercent?: number;
}

const DISPLAY_ENGINE_BY_KEY: Record<string, string> = {
  mongodb: "MongoDB",
  mysql: "MySQL",
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  redis: "Redis",
};

const DATABASE_ENGINE_ICON_BY_KEY = {
  mongo: "mongodb",
  mongodb: "mongodb",
  mysql: "mysql",
  pg: "postgresql",
  postgres: "postgresql",
  postgresql: "postgresql",
  redis: "redis",
} as const satisfies Record<string, Exclude<DeviconKey, "docker">>;

const VERSION_NUMBER_PATTERN = /\d+(?:\.\d+)+/;
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

function getToneForStatus(status: string | null | undefined) {
  const normalized = status?.trim().toLowerCase();
  return normalized && STATUS_TONES.has(normalized) ? normalized : undefined;
}

function displayEngineFromKey(engineKey: string | undefined): string {
  if (engineKey === undefined) {
    return "Unknown";
  }
  const normalized = engineKey.toLowerCase();
  return DISPLAY_ENGINE_BY_KEY[normalized] ?? engineKey;
}

function databaseEngineIconUrl(
  engineKey: string | undefined
): string | undefined {
  if (engineKey === undefined) {
    return undefined;
  }
  const iconKey = DATABASE_ENGINE_ICON_BY_KEY[engineKey.toLowerCase()];
  return iconKey === undefined
    ? undefined
    : deviconSrc(devicons[iconKey].original);
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

function databaseVersionFromResource({
  engineKey,
  status,
}: {
  engineKey: string | undefined;
  status: Record<string, unknown>;
}): string | undefined {
  return formatDatabaseVersion(
    nonEmptyString(status.clusterVersionRef),
    engineKey
  );
}

function databaseStatusFromResource(status: Record<string, unknown>) {
  const phaseRaw = nonEmptyString(status.phase) ?? "";
  const label = phaseRaw === "" ? "Unknown" : phaseRaw;
  const phaseForTone = phaseRaw === "" ? "unknown" : phaseRaw.toLowerCase();
  const tone = getToneForStatus(phaseForTone) ?? "pending";
  return { label, tone };
}

function databaseMetricsFromTelemetry(
  telemetry: DbSettingsMetricPercents | undefined
): DatabaseNodeStates["metrics"] {
  return {
    ...(telemetry?.cpuPercent === undefined
      ? {}
      : { cpu: telemetry.cpuPercent }),
    ...(telemetry?.memoryPercent === undefined
      ? {}
      : { memory: telemetry.memoryPercent }),
    ...(telemetry?.storagePercent === undefined
      ? {}
      : { storage: telemetry.storagePercent }),
  };
}

function databaseMetricCapacitiesFromStatus(
  status: Record<string, unknown>
): DatabaseNodeStates["metricCapacities"] | undefined {
  const effectiveResources = asRecord(status.effectiveResources);
  if (effectiveResources === undefined) {
    return undefined;
  }
  const cpuCapacity = nonEmptyString(effectiveResources.cpuLimit);
  const memoryCapacity = nonEmptyString(effectiveResources.memoryLimit);
  const storageCapacity = nonEmptyString(effectiveResources.storageSize);
  const metricCapacities: DatabaseNodeStates["metricCapacities"] = {
    ...(cpuCapacity === undefined ? {} : { cpu: cpuCapacity }),
    ...(memoryCapacity === undefined ? {} : { memory: memoryCapacity }),
    ...(storageCapacity === undefined ? {} : { storage: storageCapacity }),
  };
  return Object.keys(metricCapacities).length === 0
    ? undefined
    : metricCapacities;
}

function databaseConnectionsFromResource(
  spec: Record<string, unknown>,
  status: Record<string, unknown>
): DbSettingsData["connections"] {
  return [
    {
      id: "private",
      kind: "private",
      label: "Private connection",
      value: nonEmptyString(status.connectionStringPrivate),
    },
    {
      id: "public",
      kind: "public",
      label: "Public connection",
      publicAccess: { enabled: spec.exposeNodePort === true },
      value: nonEmptyString(status.connectionStringPublic),
    },
  ];
}

function databaseDesiredFromSpec(
  spec: Record<string, unknown>,
  status: Record<string, unknown>
): DbSettingsData["desired"] {
  const effectiveResources = asRecord(status.effectiveResources);
  const desiredResource = (field: "cpuLimit" | "memoryLimit" | "storageSize") =>
    nonEmptyString(spec[field]) ?? nonEmptyString(effectiveResources?.[field]);
  const replicas =
    typeof spec.replicas === "number" && Number.isFinite(spec.replicas)
      ? spec.replicas
      : undefined;
  const cpuLimit = desiredResource("cpuLimit");
  const memoryLimit = desiredResource("memoryLimit");
  const storageSize = desiredResource("storageSize");

  return {
    ...(cpuLimit === undefined ? {} : { cpuLimit }),
    exposeNodePort: spec.exposeNodePort === true,
    ...(memoryLimit === undefined ? {} : { memoryLimit }),
    ...(replicas === undefined ? {} : { replicas }),
    ...(storageSize === undefined ? {} : { storageSize }),
  };
}

function databaseMetadataFromResource(
  metadata: Record<string, unknown>
): DbSettingsData["metadata"] | undefined {
  const labels = asRecord(metadata.labels);
  if (labels === undefined || Object.keys(labels).length === 0) {
    return undefined;
  }
  return { labels };
}

function databaseBackupPolicyFromSpec(
  spec: Record<string, unknown>
): DbSettingsData["backupPolicy"] {
  const raw = asRecord(spec.backupPolicy);
  if (raw === undefined) {
    return undefined;
  }
  const cronExpression = nonEmptyString(raw.cronExpression);
  const retentionPeriod = nonEmptyString(raw.retentionPeriod);
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : undefined;
  if (
    cronExpression === undefined &&
    enabled === undefined &&
    retentionPeriod === undefined
  ) {
    return undefined;
  }
  return {
    ...(cronExpression === undefined ? {} : { cronExpression }),
    ...(enabled === undefined ? {} : { enabled }),
    ...(retentionPeriod === undefined ? {} : { retentionPeriod }),
  };
}

function databaseTelemetryForResource({
  metricsLookup,
  name,
  namespace,
}: {
  metricsLookup?: Map<string, DbSettingsMetricPercents>;
  name: string;
  namespace: string;
}): DbSettingsMetricPercents | undefined {
  if (namespace === "" || name === "") {
    return undefined;
  }
  return metricsLookup?.get(`db:${namespace}:${name}`);
}

export interface DbResourceToSettingsDataOptions {
  engineIconByName?: ReadonlyMap<string, string>;
  metricsLookup?: Map<string, DbSettingsMetricPercents>;
  namespaceFallback?: string;
}

export function dbResourceToSettingsData(
  db: unknown,
  options?: DbResourceToSettingsDataOptions
): DbSettingsData {
  const root = asRecord(db) ?? {};
  const metadata = asRecord(root.metadata) ?? {};
  const spec = asRecord(root.spec) ?? {};
  const status = asRecord(root.status) ?? {};

  const name = metadataName(db) ?? "unknown";
  const namespace = metadataNamespace(db) ?? options?.namespaceFallback ?? "";
  const uid = metadataUid(db);
  const engineKey = nonEmptyString(spec.engine);
  const telemetry = databaseTelemetryForResource({
    metricsLookup: options?.metricsLookup,
    name,
    namespace,
  });

  const formattedVersion = databaseVersionFromResource({
    engineKey,
    status,
  });
  const iconUrl =
    engineKey === undefined
      ? undefined
      : (options?.engineIconByName?.get(engineKey) ??
        databaseEngineIconUrl(engineKey));
  const metricCapacities = databaseMetricCapacitiesFromStatus(status);
  const mountPath = nonEmptyString(status.mountPath);
  const backups = Array.isArray(status.backups) ? status.backups : undefined;
  const backupPolicy = databaseBackupPolicyFromSpec(spec);

  const states: DatabaseNodeStates = {
    displayEngine: displayEngineFromKey(engineKey),
    ...(engineKey === undefined
      ? {}
      : { engineKey: engineKey as DatabaseEngineKey }),
    ...(formattedVersion === undefined ? {} : { formattedVersion }),
    ...(iconUrl === undefined ? {} : { iconUrl }),
    ...(metricCapacities === undefined ? {} : { metricCapacities }),
    metrics: databaseMetricsFromTelemetry(telemetry),
    ...(mountPath === undefined ? {} : { mountPath }),
    name,
    status: databaseStatusFromResource(status),
  };

  const resourceMetadata = databaseMetadataFromResource(metadata);

  return {
    ...(backupPolicy === undefined ? {} : { backupPolicy }),
    ...(backups === undefined ? {} : { backups }),
    connections: databaseConnectionsFromResource(spec, status),
    desired: databaseDesiredFromSpec(spec, status),
    ...(resourceMetadata === undefined ? {} : { metadata: resourceMetadata }),
    states,
    ...(uid === undefined || uid === "" ? {} : { uid }),
    workload: { name, namespace },
  };
}
