import { API_ROUTES } from "@workspace/api/constants";
import { fetcher } from "@workspace/api/fetch";
import { ApiUrl } from "@workspace/api/utils";
import { parse as parseYaml } from "yaml";
import { apNetworkSaveDraftFromNetwork } from "@/features/project-settings/ap/ap-network-model";
import type {
  ApConfigMapMount,
  ApEnvVar,
  ApNetwork,
  ApStorageMount,
} from "@/features/project-settings/ap/ap-settings-sections";
import {
  canonicalApEnvRawSource,
  compileApEnvRawSourceForRuntime,
} from "@/features/project-settings/ap/lib/ap-env-raw-source";
import {
  AP_ENV_VALUE_FROM_PLACEHOLDER,
  type ApEnvDbDsnSource,
} from "@/features/project-settings/ap/lib/ap-env-rows";
import { normalizeApEnvTokenRowsForSave } from "@/features/project-settings/ap/lib/ap-env-tokens";
import {
  CUSTOM_DOMAIN_BINDING_ID_PATTERN,
  generatePlatformAddressId,
  isCustomDomainBindingId,
  isPlatformAddressId,
  normalizeCustomDomainBindingId,
  normalizePlatformAddressId,
  PLATFORM_ADDRESS_DOMAIN_PREFIX_PATTERN,
  PLATFORM_ADDRESS_DOMAIN_PREFIX_RE,
  PLATFORM_ADDRESS_ID_PATTERN,
  stablePlatformAddressDomainPrefix,
} from "@/features/project-settings/ap/lib/platform-address";
import {
  isRoutingDomainLabelValue,
  routingDomainFromKubeconfig,
} from "@/lib/kubeconfig-routing-domain";
import {
  type ExistingCustomDomainBinding,
  normalizeCustomDomainName,
} from "./ap-public-access";
import {
  type ApReplicaStrategy,
  canonicalApReplicaStrategy,
  canonicalFixedReplicaStrategy,
  DEFAULT_AP_ELASTIC_CPU_UTILIZATION_PERCENT,
  DEFAULT_AP_ELASTIC_MAX_REPLICAS,
  DEFAULT_AP_ELASTIC_MIN_REPLICAS,
  validateApFixedReplicas,
} from "./ap-replica-strategy";
import {
  patchOpsForApInput,
  patchOpsForApResource,
  patchOpsFromEffectiveSnapshot,
  readApInput,
  readApReplicaStrategy,
} from "./ap-spec-access";
import type { K8sJsonPatchOp } from "./http/json-patch";

const LEGACY_AP_NETWORK_INPUT_FIELDS = [
  "endpoints",
  "port",
  "host",
  "privatePort",
] as const;

interface ApNetworkAppListeningPortsPatch {
  appListeningPorts?: readonly NonNullable<
    ApNetwork["appListeningPorts"]
  >[number][];
  privatePort?: ApNetwork["privatePort"];
}

type ApNetworkSettingsPatch = ApNetworkAppListeningPortsPatch &
  Partial<{
    customDomains: readonly NonNullable<ApNetwork["customDomains"]>[number][];
    publicAddresses: readonly ApNetwork["publicAddresses"][number][];
  }>;

type ApPrivatePortSettingsPatch = Pick<ApNetwork, "privatePort">;

type ApPublicAddressesSettingsPatch = ApNetworkAppListeningPortsPatch & {
  customDomains?: readonly NonNullable<ApNetwork["customDomains"]>[number][];
  publicAddresses: readonly ApNetwork["publicAddresses"][number][];
};

interface ApNetworkSettingsPatchOptions {
  dbDsnReferenceSources?: readonly ApEnvDbDsnSource[];
  envRawSource?: string;
  existingCustomDomains?: readonly ExistingCustomDomainBinding[];
  metadata?: Record<string, unknown>;
  routingDomain?: string;
}

export interface ApSettingsDraftPatch {
  args?: readonly string[];
  command?: readonly string[];
  configMaps?: readonly ApConfigMapMount[];
  cpuCores?: number;
  env?: readonly ApEnvVar[];
  envRawSource?: string;
  image?: string;
  memoryMib?: number;
  network?: ApNetworkSettingsPatch;
  replicaStrategy?: ApReplicaStrategy;
  replicas?: number;
  storage?: readonly ApStorageMount[];
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function normalizeStringList(value: readonly string[] | undefined): string[] {
  return (value ?? []).map((item) => item.trim()).filter(Boolean);
}

function stringListsEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): boolean {
  const left = normalizeStringList(a);
  const right = normalizeStringList(b);
  return (
    left.length === right.length && left.every((item, i) => item === right[i])
  );
}

function normalizeConfigMapMounts(
  value: readonly ApConfigMapMount[] | undefined
): ApConfigMapMount[] {
  return (value ?? [])
    .map((item) => ({ path: item.path.trim(), value: item.value }))
    .filter((item) => item.path !== "" || item.value !== "");
}

function configMapMountsEqual(
  a: readonly ApConfigMapMount[] | undefined,
  b: readonly ApConfigMapMount[] | undefined
): boolean {
  const left = normalizeConfigMapMounts(a);
  const right = normalizeConfigMapMounts(b);
  return (
    left.length === right.length &&
    left.every((item, i) => {
      const other = right[i];
      return (
        other != null && item.path === other.path && item.value === other.value
      );
    })
  );
}

function normalizeStorageMounts(
  value: readonly ApStorageMount[] | undefined
): ApStorageMount[] {
  return (value ?? [])
    .map((item) => ({ path: item.path.trim(), size: item.size.trim() }))
    .filter((item) => item.path !== "" || item.size !== "");
}

function storageMountsEqual(
  a: readonly ApStorageMount[] | undefined,
  b: readonly ApStorageMount[] | undefined
): boolean {
  const left = normalizeStorageMounts(a);
  const right = normalizeStorageMounts(b);
  return (
    left.length === right.length &&
    left.every((item, i) => {
      const other = right[i];
      return (
        other != null && item.path === other.path && item.size === other.size
      );
    })
  );
}

function assertApProductForPatch(
  kubeconfig: string,
  resource: Record<string, unknown>
): { name: string; namespace: string } {
  const trimmedKc = kubeconfig.trim();
  if (trimmedKc === "") {
    throw new Error("Kubeconfig is missing.");
  }
  const kind =
    typeof resource.kind === "string" ? resource.kind.trim().toUpperCase() : "";
  if (kind !== "AP") {
    throw new Error("Only AP resources can be patched from AP settings.");
  }
  const meta = asRecord(resource.metadata);
  const name = typeof meta?.name === "string" ? meta.name.trim() : "";
  const namespace =
    typeof meta?.namespace === "string" ? meta.namespace.trim() : "";
  if (name === "" || namespace === "") {
    throw new Error(
      "AP resource must have metadata.name and metadata.namespace."
    );
  }
  return { name, namespace };
}

function mergePatchSetPath(
  target: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.split("/").filter(Boolean);
  if (!["metadata", "spec"].includes(parts[0] ?? "") || parts.length < 2) {
    return;
  }
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    const existing = asRecord(cursor[part]);
    if (existing == null) {
      const next: Record<string, unknown> = {};
      cursor[part] = next;
      cursor = next;
      continue;
    }
    cursor = existing;
  }
  const key = parts.at(-1);
  if (key != null) {
    cursor[key] = value;
  }
}

const AP_NETWORK_REPLACE_FIELDS = [
  "appListeningPorts",
  "customDomains",
  "endpoints",
  "host",
  "platformAddresses",
  "port",
  "privatePort",
  "publicAddresses",
] as const;

function apNetworkReplacementMergePatchValue(value: unknown): unknown {
  const network = asRecord(value);
  if (network == null) {
    return value;
  }
  const out: Record<string, unknown> = { ...network };
  for (const field of AP_NETWORK_REPLACE_FIELDS) {
    if (!Object.hasOwn(network, field)) {
      out[field] = null;
    }
  }
  return out;
}

function mergePatchValueForJsonPatchOp(op: K8sJsonPatchOp): unknown {
  if (op.op === "remove") {
    return null;
  }
  if (op.path === "/spec/input/network") {
    return apNetworkReplacementMergePatchValue(op.value);
  }
  return op.value;
}

export function apMergePatchFromJsonPatchOps(
  ops: readonly K8sJsonPatchOp[]
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const op of ops) {
    mergePatchSetPath(patch, op.path, mergePatchValueForJsonPatchOp(op));
  }
  return patch;
}

async function patchAp(
  kubeconfig: string,
  resource: Record<string, unknown>,
  ops: K8sJsonPatchOp[]
): Promise<void> {
  const kc = kubeconfig.trim();
  const { name, namespace } = assertApProductForPatch(kc, resource);
  if (ops.length === 0) {
    return;
  }
  await fetcher({
    base: ApiUrl(),
    body: apMergePatchFromJsonPatchOps(ops),
    header: {
      Authorization: `Bearer ${encodeURIComponent(kc)}`,
    },
    method: "PATCH",
    path: API_ROUTES.ap.root,
    query: {
      name,
      namespace,
    },
  });
}

function removeExistingApInputFields(
  ops: K8sJsonPatchOp[],
  input: Record<string, unknown> | undefined,
  fields: readonly string[]
): void {
  if (input == null) {
    return;
  }
  for (const field of fields) {
    if (Object.hasOwn(input, field)) {
      ops.push({ op: "remove", path: `/spec/input/${field}` });
    }
  }
}

function apHasRoutingDomain(metadata: Record<string, unknown> | undefined) {
  const labels = asRecord(metadata?.labels);
  const region = typeof labels?.region === "string" ? labels.region.trim() : "";
  return region !== "";
}

function appendRoutingDomainPatch(
  ops: K8sJsonPatchOp[],
  metadata: Record<string, unknown> | undefined,
  routingDomain: string,
  hasPublicAddresses: boolean
): void {
  const domain = routingDomain.trim();
  if (
    !hasPublicAddresses ||
    domain === "" ||
    !isRoutingDomainLabelValue(domain) ||
    apHasRoutingDomain(metadata)
  ) {
    return;
  }

  if (asRecord(metadata?.labels) == null) {
    ops.push({
      op: "add",
      path: "/metadata/labels",
      value: { region: domain },
    });
    return;
  }

  ops.push({ op: "add", path: "/metadata/labels/region", value: domain });
}

/** Kubernetes container cpu limit string from UI cores (e.g. 0.25 → `250m`, 2 → `2`). */
export function coresToCpuLimit(cores: number): string {
  const c = Number(cores);
  if (!Number.isFinite(c) || c <= 0) {
    return "250m";
  }
  const milli = Math.round(c * 1000);
  if (milli % 1000 === 0) {
    return String(milli / 1000);
  }
  return `${milli}m`;
}

/** Kubernetes memory limit from MiB (e.g. 512 → `512Mi`). */
export function mibToMemoryLimit(mib: number): string {
  const m = Math.round(Number(mib));
  const safe = Number.isFinite(m) && m > 0 ? m : 512;
  return `${safe}Mi`;
}

function buildEnvArray(
  originalEnv: unknown,
  edited: ApEnvVar[]
): Record<string, unknown>[] {
  const orig = Array.isArray(originalEnv) ? originalEnv : [];
  const byName = new Map<string, Record<string, unknown>>();
  for (const item of orig) {
    const o = asRecord(item);
    if (o == null) {
      continue;
    }
    const n = o.name;
    if (typeof n === "string" && n !== "") {
      byName.set(n, o);
    }
  }

  return edited.map((e) => {
    if (e.valueSource === "valueFrom" && e.valueFrom != null) {
      return { name: e.name, valueFrom: e.valueFrom };
    }
    if (e.value === AP_ENV_VALUE_FROM_PLACEHOLDER) {
      const prev = byName.get(e.name);
      if (prev != null && prev.valueFrom != null) {
        return { name: e.name, valueFrom: prev.valueFrom };
      }
    }
    return { name: e.name, value: e.value };
  });
}

function canonicalApReplicaStrategyForPatch(
  spec: Record<string, unknown> | undefined,
  replicaStrategy: ApReplicaStrategy
): ApReplicaStrategy {
  if (replicaStrategy.type === "elastic") {
    return canonicalApReplicaStrategy(replicaStrategy);
  }

  const currentStrategy = readApReplicaStrategy(spec ?? {});
  return canonicalFixedReplicaStrategy(
    replicaStrategy.fixed.replicas,
    replicaStrategy.elastic ?? currentStrategy.elastic
  );
}

function defaultApElasticSettings() {
  return {
    maxReplicas: DEFAULT_AP_ELASTIC_MAX_REPLICAS,
    minReplicas: DEFAULT_AP_ELASTIC_MIN_REPLICAS,
    target: {
      metric: "cpu",
      type: "utilization",
      utilizationPercent: DEFAULT_AP_ELASTIC_CPU_UTILIZATION_PERCENT,
    },
  } as const;
}

function apElasticSettingsForCompare(strategy: ApReplicaStrategy) {
  if (strategy.type === "elastic") {
    return strategy.elastic;
  }
  return strategy.elastic ?? defaultApElasticSettings();
}

function apElasticTargetsEqual(
  a: ReturnType<typeof apElasticSettingsForCompare>["target"],
  b: ReturnType<typeof apElasticSettingsForCompare>["target"]
): boolean {
  if (a.metric !== b.metric) {
    return false;
  }
  if (a.metric === "memory") {
    return b.metric === "memory" && a.averageValue === b.averageValue;
  }
  return (
    b.metric === "cpu" &&
    Math.round(a.utilizationPercent) === Math.round(b.utilizationPercent)
  );
}

function apReplicaStrategiesEqual(
  a: ApReplicaStrategy | undefined,
  b: ApReplicaStrategy | undefined
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  if (a.type !== b.type) {
    return false;
  }
  if (Math.round(a.fixed.replicas) !== Math.round(b.fixed.replicas)) {
    return false;
  }
  const aElastic = apElasticSettingsForCompare(a);
  const bElastic = apElasticSettingsForCompare(b);
  return (
    Math.round(aElastic.minReplicas) === Math.round(bElastic.minReplicas) &&
    Math.round(aElastic.maxReplicas) === Math.round(bElastic.maxReplicas) &&
    apElasticTargetsEqual(aElastic.target, bElastic.target)
  );
}

function apNetworksEqual(
  a: ApNetworkSettingsPatch | undefined,
  b: ApNetworkSettingsPatch | undefined
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return (
    JSON.stringify(apNetworkSettingsPatchSaveDraft(a)) ===
    JSON.stringify(apNetworkSettingsPatchSaveDraft(b))
  );
}

function appListeningPortsEqual(
  a: readonly Record<string, unknown>[],
  b: readonly Record<string, unknown>[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((row, index) => {
    const other = b[index];
    return (
      other != null &&
      Math.round(Number(row.port)) === Math.round(Number(other.port))
    );
  });
}

function apSettingsImageChanged(
  next: string | undefined,
  previous: string | undefined
): boolean {
  return next !== undefined && next.trim() !== (previous ?? "").trim();
}

function buildApNetworkInput(
  network: ApNetworkSettingsPatch,
  options: ApNetworkSettingsPatchOptions = {}
): {
  hasPublicAddresses: boolean;
  networkInput: Record<string, unknown>;
} {
  const saveDraft = apNetworkSettingsPatchSaveDraft(network);
  const appListeningPorts = normalizedAppListeningPortsForSave(network);
  const platformAddresses = validatedPlatformAddresses(
    saveDraft.publicAddresses
  );
  const customDomains = validatedCustomDomains(
    saveDraft.customDomains,
    platformAddresses,
    options
  );
  const networkInput: Record<string, unknown> = { appListeningPorts };
  if (platformAddresses != null && platformAddresses.length > 0) {
    networkInput.platformAddresses = platformAddresses;
  }
  if (customDomains != null && customDomains.length > 0) {
    networkInput.customDomains = customDomains;
  }
  return {
    hasPublicAddresses: (platformAddresses?.length ?? 0) > 0,
    networkInput,
  };
}

function apNetworkSettingsPatchSaveDraft(
  network: ApNetworkSettingsPatch
): ApNetwork {
  return apNetworkSaveDraftFromNetwork({
    ...(network.appListeningPorts == null
      ? {}
      : {
          appListeningPorts: network.appListeningPorts.map((row) => ({
            port: row.port,
          })),
        }),
    ...(network.customDomains == null
      ? {}
      : { customDomains: [...network.customDomains] }),
    privatePort:
      network.privatePort ?? network.appListeningPorts?.[0]?.port ?? Number.NaN,
    publicAddresses: [...(network.publicAddresses ?? [])],
  });
}

function sourcePortRowsForSave(
  network: ApNetworkAppListeningPortsPatch
): readonly { port: number | undefined }[] {
  if (
    network.appListeningPorts != null &&
    network.appListeningPorts.length > 0
  ) {
    return network.appListeningPorts;
  }
  return [{ port: network.privatePort }];
}

function normalizedAppListeningPortsForSave(
  network: ApNetworkAppListeningPortsPatch
): Record<string, unknown>[] {
  const seen = new Set<number>();
  return sourcePortRowsForSave(network).map((row) => {
    const port = validatedNetworkPort(
      row.port ?? Number.NaN,
      "App Listening Port"
    );
    if (seen.has(port)) {
      throw new Error("App Listening Ports must be unique.");
    }
    seen.add(port);
    return { port };
  });
}

function portFromUnknown(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) {
    return undefined;
  }
  return n;
}

function normalizedAppListeningPortsFromInputNetwork(
  inputNetwork: Record<string, unknown>
): Record<string, unknown>[] {
  const rawPorts = inputNetwork.appListeningPorts;
  if (Array.isArray(rawPorts) && rawPorts.length > 0) {
    return rawPorts.map((row) => {
      const port = validatedNetworkPort(
        portFromUnknown(asRecord(row)?.port) ?? Number.NaN,
        "App Listening Port"
      );
      return { port };
    });
  }

  const legacyPort = portFromUnknown(inputNetwork.privatePort);
  return legacyPort == null ? [] : [{ port: legacyPort }];
}

function appListeningPortsForPublicAddressPatch(
  inputNetwork: Record<string, unknown>,
  network: ApPublicAddressesSettingsPatch
): Record<string, unknown>[] | null {
  if (
    network.appListeningPorts != null &&
    network.appListeningPorts.length > 0
  ) {
    const nextPorts = normalizedAppListeningPortsForSave({
      appListeningPorts: network.appListeningPorts,
      privatePort:
        network.appListeningPorts[0]?.port ??
        portFromUnknown(network.privatePort) ??
        80,
    });
    const currentPorts =
      normalizedAppListeningPortsFromInputNetwork(inputNetwork);
    return appListeningPortsEqual(currentPorts, nextPorts) ? null : nextPorts;
  }

  return null;
}

export function patchOpsForApPrivatePortSettings(
  spec: Record<string, unknown> | undefined,
  network: ApPrivatePortSettingsPatch
): K8sJsonPatchOp[] {
  const appListeningPorts = normalizedAppListeningPortsForSave({
    appListeningPorts: [{ port: network.privatePort }],
    privatePort: network.privatePort,
  });
  const input = asRecord(spec?.input);
  const inputNetwork = asRecord(readApInput(spec ?? {}).network);
  const ops =
    inputNetwork == null
      ? patchOpsForApInput(spec, { network: { appListeningPorts } })
      : [
          {
            op: Object.hasOwn(inputNetwork, "appListeningPorts")
              ? "replace"
              : "add",
            path: "/spec/input/network/appListeningPorts",
            value: appListeningPorts,
          } satisfies K8sJsonPatchOp,
        ];
  removeExistingApInputFields(ops, input, LEGACY_AP_NETWORK_INPUT_FIELDS);
  return ops;
}

function networkInputFieldPatch(
  network: Record<string, unknown>,
  field: "appListeningPorts" | "customDomains" | "platformAddresses",
  value: Record<string, unknown>[]
): K8sJsonPatchOp | null {
  if (value.length === 0) {
    return Object.hasOwn(network, field)
      ? { op: "remove", path: `/spec/input/network/${field}` }
      : null;
  }
  return {
    op: Object.hasOwn(network, field) ? "replace" : "add",
    path: `/spec/input/network/${field}`,
    value,
  };
}

export function patchOpsForApPublicAddressesSettings(
  spec: Record<string, unknown> | undefined,
  network: ApPublicAddressesSettingsPatch,
  options: ApNetworkSettingsPatchOptions = {}
): K8sJsonPatchOp[] {
  const inputNetwork = asRecord(readApInput(spec ?? {}).network);
  if (inputNetwork == null) {
    throw new Error("AP network settings are missing.");
  }

  const saveDraft = apNetworkSettingsPatchSaveDraft(network);
  const platformAddresses =
    validatedPlatformAddresses(saveDraft.publicAddresses) ?? [];
  const appListeningPorts = appListeningPortsForPublicAddressPatch(
    inputNetwork,
    network
  );
  const customDomains =
    validatedCustomDomains(
      saveDraft.customDomains,
      platformAddresses,
      options
    ) ?? [];
  const ops = [
    appListeningPorts == null
      ? null
      : networkInputFieldPatch(
          inputNetwork,
          "appListeningPorts",
          appListeningPorts
        ),
    networkInputFieldPatch(
      inputNetwork,
      "platformAddresses",
      platformAddresses
    ),
    networkInputFieldPatch(inputNetwork, "customDomains", customDomains),
  ].filter((op): op is K8sJsonPatchOp => op != null);
  removeExistingApInputFields(
    ops,
    asRecord(spec?.input),
    LEGACY_AP_NETWORK_INPUT_FIELDS
  );
  appendRoutingDomainPatch(
    ops,
    options.metadata,
    options.routingDomain ?? "",
    platformAddresses.length > 0
  );
  return ops;
}

export async function applyApImage(
  kubeconfig: string,
  claim: Record<string, unknown>,
  image: string
): Promise<void> {
  const img = image.trim();
  if (img === "") {
    throw new Error("Image reference is empty.");
  }
  const spec = asRecord(claim.spec);
  await patchAp(kubeconfig, claim, patchOpsForApInput(spec, { image: img }));
}

export async function applyApCpuLimit(
  kubeconfig: string,
  claim: Record<string, unknown>,
  cpuCores: number
): Promise<void> {
  const spec = asRecord(claim.spec);
  await patchAp(kubeconfig, claim, [
    ...patchOpsForApResource(spec, {
      limits: { cpu: coresToCpuLimit(cpuCores) },
    }),
  ]);
}

export async function applyApMemoryLimit(
  kubeconfig: string,
  claim: Record<string, unknown>,
  memoryMib: number
): Promise<void> {
  const spec = asRecord(claim.spec);
  await patchAp(kubeconfig, claim, [
    ...patchOpsForApResource(spec, {
      limits: { memory: mibToMemoryLimit(memoryMib) },
    }),
  ]);
}

/** One JSON Patch for CPU, memory, and/or replicas (avoids parallel PATCH races). */
export function patchOpsForApResourceQuotaSettings(
  spec: Record<string, unknown> | undefined,
  next: {
    cpuCores?: number;
    memoryMib?: number;
    replicaStrategy?: ApReplicaStrategy;
    replicas?: number;
  }
): K8sJsonPatchOp[] {
  const merge: Record<string, unknown> = {};
  const limits: Record<string, unknown> = {};
  if (next.cpuCores !== undefined) {
    limits.cpu = coresToCpuLimit(next.cpuCores);
  }
  if (next.memoryMib !== undefined) {
    limits.memory = mibToMemoryLimit(next.memoryMib);
  }
  if (Object.keys(limits).length > 0) {
    merge.limits = limits;
  }
  if (next.replicaStrategy !== undefined) {
    merge.replicaStrategy = canonicalApReplicaStrategyForPatch(
      spec,
      next.replicaStrategy
    );
    return patchOpsForApResource(spec, merge);
  }
  if (next.replicas !== undefined) {
    const currentStrategy = readApReplicaStrategy(spec ?? {});
    merge.replicaStrategy = canonicalFixedReplicaStrategy(
      next.replicas,
      currentStrategy.elastic
    );
  }
  return patchOpsForApResource(spec, merge);
}

export function patchOpsForApReplicaStrategySettings(
  spec: Record<string, unknown> | undefined,
  replicaStrategy: ApReplicaStrategy
): K8sJsonPatchOp[] {
  return patchOpsForApResource(spec, {
    replicaStrategy: canonicalApReplicaStrategyForPatch(spec, replicaStrategy),
  });
}

export async function applyApResourceQuotas(
  kubeconfig: string,
  claim: Record<string, unknown>,
  next: {
    cpuCores: number;
    memoryMib: number;
    replicaStrategy?: ApReplicaStrategy;
    replicas?: number;
  },
  previous: { cpuCores: number; memoryMib: number; replicas?: number }
): Promise<void> {
  const cpuChanged = Math.abs(next.cpuCores - previous.cpuCores) > 1e-9;
  const memChanged =
    Math.round(next.memoryMib) !== Math.round(previous.memoryMib);

  const repNext = next.replicas;
  const repPrev = previous.replicas;
  const replicasChanged =
    repNext !== undefined &&
    repPrev !== undefined &&
    Math.round(repNext) !== Math.round(repPrev);
  const replicaStrategyChanged = next.replicaStrategy !== undefined;

  if (
    !(cpuChanged || memChanged || replicasChanged || replicaStrategyChanged)
  ) {
    return;
  }

  const spec = asRecord(claim.spec);
  const patch = patchOpsForApResourceQuotaSettings(spec, {
    ...(cpuChanged ? { cpuCores: next.cpuCores } : {}),
    ...(memChanged ? { memoryMib: next.memoryMib } : {}),
    ...(next.replicaStrategy === undefined
      ? {}
      : { replicaStrategy: next.replicaStrategy }),
    ...(repNext === undefined ? {} : { replicas: repNext }),
  });

  await patchAp(kubeconfig, claim, patch);
}

export function patchOpsForApEnvSettings(
  spec: Record<string, unknown> | undefined,
  env: ApEnvVar[],
  options: Pick<
    ApNetworkSettingsPatchOptions,
    "dbDsnReferenceSources" | "envRawSource"
  > = {}
): K8sJsonPatchOp[] {
  const input = readApInput(spec ?? {});
  if (options.envRawSource !== undefined) {
    const result = compileApEnvRawSourceForRuntime(
      options.envRawSource,
      options.dbDsnReferenceSources
    );
    if (!result.valid) {
      throw new Error(result.diagnostics[0]?.message ?? "Invalid environment.");
    }
    return patchOpsForApInput(spec, {
      env: buildEnvArray(input.env, result.env),
      envRawSource: result.envRawSource,
    });
  }

  const result = normalizeApEnvTokenRowsForSave(
    env,
    options.dbDsnReferenceSources
  );
  if (!result.valid) {
    throw new Error(result.diagnostics[0]?.message ?? "Invalid environment.");
  }
  const envRawSource = canonicalApEnvRawSource({ env: result.env });
  return patchOpsForApInput(spec, {
    env: buildEnvArray(input.env, result.env),
    envRawSource,
  });
}

function validatedNetworkPort(port: number, label: string): number {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) {
    throw new Error(`${label} must be an integer from 1 through 65535.`);
  }
  return n;
}

function validatedPlatformAddresses(
  publicAddresses: readonly ApNetwork["publicAddresses"][number][] | undefined
): Record<string, unknown>[] | undefined {
  if (publicAddresses == null) {
    return undefined;
  }
  const seenIds = new Set<string>();
  return publicAddresses
    .filter((address) => address.type?.trim().toLowerCase() !== "observed")
    .map((address) => {
      const rawId = normalizePlatformAddressId(address.id);
      let id = rawId === "" ? generatePlatformAddressId() : rawId;
      while (rawId === "" && seenIds.has(id)) {
        id = generatePlatformAddressId();
      }
      if (!isPlatformAddressId(id)) {
        throw new Error(
          `Platform Address ID must match ${PLATFORM_ADDRESS_ID_PATTERN}.`
        );
      }
      if (seenIds.has(id)) {
        throw new Error("Platform Address IDs must be unique.");
      }
      seenIds.add(id);
      const rawDomainPrefix =
        typeof address.domainPrefix === "string"
          ? address.domainPrefix.trim().toLowerCase()
          : "";
      const domainPrefix =
        rawDomainPrefix === ""
          ? stablePlatformAddressDomainPrefix(id)
          : rawDomainPrefix;
      if (!PLATFORM_ADDRESS_DOMAIN_PREFIX_RE.test(domainPrefix)) {
        throw new Error(
          `Platform Address domainPrefix must match ${PLATFORM_ADDRESS_DOMAIN_PREFIX_PATTERN}.`
        );
      }
      return {
        domainPrefix,
        id,
        port: validatedNetworkPort(address.port, "Public Address target port"),
      };
    });
}

function validatedCustomDomains(
  customDomains:
    | readonly NonNullable<ApNetwork["customDomains"]>[number][]
    | undefined,
  platformAddresses: readonly Record<string, unknown>[] | undefined,
  options: ApNetworkSettingsPatchOptions = {}
): Record<string, unknown>[] | undefined {
  if (customDomains == null) {
    return undefined;
  }

  const platformAddressIds = new Set(
    (platformAddresses ?? []).flatMap((address) => {
      const id = normalizePlatformAddressId(address.id);
      return isPlatformAddressId(id) ? [id] : [];
    })
  );
  const seenIds = new Set<string>();
  const seenDomains = new Set<string>();
  const seenPlatformAddressIds = new Set<string>();

  return customDomains.map((customDomain) => {
    const id = normalizeCustomDomainBindingId(customDomain.id);
    if (!isCustomDomainBindingId(id)) {
      throw new Error(
        `Custom Domain Binding ID must match ${CUSTOM_DOMAIN_BINDING_ID_PATTERN}.`
      );
    }
    if (seenIds.has(id)) {
      throw new Error("Custom Domain Binding IDs must be unique.");
    }
    seenIds.add(id);

    const platformAddressId = normalizePlatformAddressId(
      customDomain.platformAddressId
    );
    if (!platformAddressIds.has(platformAddressId)) {
      throw new Error(
        "Custom Domain Binding must reference an existing Platform Address."
      );
    }
    if (seenPlatformAddressIds.has(platformAddressId)) {
      throw new Error(
        "Platform Address can only be bound to one Custom Domain."
      );
    }
    seenPlatformAddressIds.add(platformAddressId);

    const domain = normalizeCustomDomainName(customDomain.domain);
    if (domain === "") {
      throw new Error("Custom Domain is required.");
    }
    if (seenDomains.has(domain)) {
      throw new Error("Custom Domain can only be bound once.");
    }
    seenDomains.add(domain);
    assertCustomDomainAvailableInNamespace(domain, options);

    return {
      domain,
      id,
      platformAddressId,
    };
  });
}

function assertCustomDomainAvailableInNamespace(
  domain: string,
  options: ApNetworkSettingsPatchOptions
): void {
  const metadata = options.metadata;
  const namespace =
    typeof metadata?.namespace === "string" ? metadata.namespace.trim() : "";
  const currentAp =
    typeof metadata?.name === "string" ? metadata.name.trim() : "";
  if (namespace === "" || currentAp === "") {
    return;
  }

  for (const binding of options.existingCustomDomains ?? []) {
    if (binding.namespace.trim() !== namespace) {
      continue;
    }
    if (normalizeCustomDomainName(binding.domain) !== domain) {
      continue;
    }
    if (binding.apRef.trim() === currentAp) {
      continue;
    }
    throw new Error("Custom Domain is already bound in this namespace.");
  }
}

export function patchOpsForApNetworkSettings(
  spec: Record<string, unknown> | undefined,
  network: ApNetworkSettingsPatch,
  options: ApNetworkSettingsPatchOptions = {}
): K8sJsonPatchOp[] {
  const { hasPublicAddresses, networkInput } = buildApNetworkInput(
    network,
    options
  );
  const input = asRecord(spec?.input);
  const ops = patchOpsForApInput(spec, { network: networkInput });
  removeExistingApInputFields(ops, input, LEGACY_AP_NETWORK_INPUT_FIELDS);
  appendRoutingDomainPatch(
    ops,
    options.metadata,
    options.routingDomain ?? "",
    hasPublicAddresses
  );
  return ops;
}

function appendApSettingsDraftLaunchPatch(
  inputPatch: Record<string, unknown>,
  next: ApSettingsDraftPatch,
  previous: ApSettingsDraftPatch
): void {
  if (
    next.command !== undefined &&
    !stringListsEqual(next.command, previous.command)
  ) {
    inputPatch.command = normalizeStringList(next.command);
  }

  if (next.args !== undefined && !stringListsEqual(next.args, previous.args)) {
    inputPatch.args = normalizeStringList(next.args);
  }

  if (
    next.configMaps !== undefined &&
    !configMapMountsEqual(next.configMaps, previous.configMaps)
  ) {
    inputPatch.configMaps = normalizeConfigMapMounts(next.configMaps);
  }

  if (
    next.storage !== undefined &&
    !storageMountsEqual(next.storage, previous.storage)
  ) {
    inputPatch.storage = normalizeStorageMounts(next.storage);
  }
}

function patchOpsForApSettingsDraftInput(
  spec: Record<string, unknown> | undefined,
  next: ApSettingsDraftPatch,
  previous: ApSettingsDraftPatch,
  options: ApNetworkSettingsPatchOptions = {}
): K8sJsonPatchOp[] {
  const ops: K8sJsonPatchOp[] = [];
  const inputPatch: Record<string, unknown> = {};
  const input = asRecord(spec?.input);
  let networkHasPublicAddresses = false;
  let networkChanged = false;

  if (apSettingsImageChanged(next.image, previous.image)) {
    const image = next.image?.trim() ?? "";
    if (image === "") {
      throw new Error("Image reference is empty.");
    }
    inputPatch.image = image;
  }

  if (next.env !== undefined) {
    const nextRawSource = canonicalApEnvRawSource({
      env: next.env,
      envRawSource: next.envRawSource,
    });
    const previousRawSource = canonicalApEnvRawSource({
      env: previous.env ?? [],
      envRawSource: previous.envRawSource,
    });
    if (nextRawSource !== previousRawSource) {
      const result = compileApEnvRawSourceForRuntime(
        nextRawSource,
        options.dbDsnReferenceSources
      );
      if (!result.valid) {
        throw new Error(
          result.diagnostics[0]?.message ?? "Invalid environment."
        );
      }
      inputPatch.env = buildEnvArray(readApInput(spec ?? {}).env, result.env);
      inputPatch.envRawSource = result.envRawSource;
    }
  }

  appendApSettingsDraftLaunchPatch(inputPatch, next, previous);

  if (
    next.network !== undefined &&
    !apNetworksEqual(next.network, previous.network)
  ) {
    const { hasPublicAddresses, networkInput } = buildApNetworkInput(
      next.network,
      options
    );
    inputPatch.network = networkInput;
    networkHasPublicAddresses = hasPublicAddresses;
    networkChanged = true;
  }

  if (Object.keys(inputPatch).length > 0) {
    ops.push(...patchOpsForApInput(spec, inputPatch));
  }
  if (networkChanged) {
    removeExistingApInputFields(ops, input, LEGACY_AP_NETWORK_INPUT_FIELDS);
    appendRoutingDomainPatch(
      ops,
      options.metadata,
      options.routingDomain ?? "",
      networkHasPublicAddresses
    );
  }
  return ops;
}

function apSettingsDraftResourcePatch(
  next: ApSettingsDraftPatch,
  previous: ApSettingsDraftPatch
): Pick<
  ApSettingsDraftPatch,
  "cpuCores" | "memoryMib" | "replicaStrategy" | "replicas"
> {
  const resourcePatch: Pick<
    ApSettingsDraftPatch,
    "cpuCores" | "memoryMib" | "replicaStrategy" | "replicas"
  > = {};
  if (
    next.cpuCores !== undefined &&
    (previous.cpuCores === undefined ||
      Math.abs(next.cpuCores - previous.cpuCores) > 1e-9)
  ) {
    resourcePatch.cpuCores = next.cpuCores;
  }
  if (
    next.memoryMib !== undefined &&
    (previous.memoryMib === undefined ||
      Math.round(next.memoryMib) !== Math.round(previous.memoryMib))
  ) {
    resourcePatch.memoryMib = next.memoryMib;
  }
  if (
    next.replicaStrategy !== undefined &&
    !apReplicaStrategiesEqual(next.replicaStrategy, previous.replicaStrategy)
  ) {
    resourcePatch.replicaStrategy = next.replicaStrategy;
  } else if (
    next.replicas !== undefined &&
    (previous.replicas === undefined ||
      Math.round(next.replicas) !== Math.round(previous.replicas))
  ) {
    resourcePatch.replicas = next.replicas;
  }
  return resourcePatch;
}

function patchOpsForApSettingsDraftResource(
  spec: Record<string, unknown> | undefined,
  next: ApSettingsDraftPatch,
  previous: ApSettingsDraftPatch
): K8sJsonPatchOp[] {
  const resourcePatch = apSettingsDraftResourcePatch(next, previous);
  if (Object.keys(resourcePatch).length > 0) {
    return patchOpsForApResourceQuotaSettings(spec, resourcePatch);
  }
  return [];
}

export function patchOpsForApSettingsDraft(
  spec: Record<string, unknown> | undefined,
  next: ApSettingsDraftPatch,
  previous: ApSettingsDraftPatch,
  options: ApNetworkSettingsPatchOptions = {}
): K8sJsonPatchOp[] {
  return [
    ...patchOpsForApSettingsDraftInput(spec, next, previous, options),
    ...patchOpsForApSettingsDraftResource(spec, next, previous),
  ];
}

export async function applyApEnv(
  kubeconfig: string,
  claim: Record<string, unknown>,
  env: ApEnvVar[],
  options: Pick<
    ApNetworkSettingsPatchOptions,
    "dbDsnReferenceSources" | "envRawSource"
  > = {}
): Promise<void> {
  const spec = asRecord(claim.spec);
  await patchAp(
    kubeconfig,
    claim,
    patchOpsForApEnvSettings(spec, env, options)
  );
}

export async function applyApNetwork(
  kubeconfig: string,
  claim: Record<string, unknown>,
  network: ApNetworkSettingsPatch,
  options: Pick<ApNetworkSettingsPatchOptions, "existingCustomDomains"> = {}
): Promise<void> {
  const spec = asRecord(claim.spec);
  await patchAp(
    kubeconfig,
    claim,
    patchOpsForApNetworkSettings(spec, network, {
      existingCustomDomains: options.existingCustomDomains,
      metadata: asRecord(claim.metadata),
      routingDomain: routingDomainFromKubeconfig(kubeconfig),
    })
  );
}

export async function applyApPrivatePort(
  kubeconfig: string,
  claim: Record<string, unknown>,
  network: ApPrivatePortSettingsPatch
): Promise<void> {
  const spec = asRecord(claim.spec);
  await patchAp(
    kubeconfig,
    claim,
    patchOpsForApPrivatePortSettings(spec, network)
  );
}

export async function applyApPublicAddresses(
  kubeconfig: string,
  claim: Record<string, unknown>,
  network: ApPublicAddressesSettingsPatch,
  options: Pick<ApNetworkSettingsPatchOptions, "existingCustomDomains"> = {}
): Promise<void> {
  const spec = asRecord(claim.spec);
  await patchAp(
    kubeconfig,
    claim,
    patchOpsForApPublicAddressesSettings(spec, network, {
      existingCustomDomains: options.existingCustomDomains,
      metadata: asRecord(claim.metadata),
      routingDomain: routingDomainFromKubeconfig(kubeconfig),
    })
  );
}

export async function applyApSettingsDraft(
  kubeconfig: string,
  claim: Record<string, unknown>,
  next: ApSettingsDraftPatch,
  previous: ApSettingsDraftPatch,
  options: Pick<
    ApNetworkSettingsPatchOptions,
    "dbDsnReferenceSources" | "existingCustomDomains"
  > = {}
): Promise<void> {
  const spec = asRecord(claim.spec);
  const patch = patchOpsForApSettingsDraft(spec, next, previous, {
    dbDsnReferenceSources: options.dbDsnReferenceSources,
    existingCustomDomains: options.existingCustomDomains,
    metadata: asRecord(claim.metadata),
    routingDomain: routingDomainFromKubeconfig(kubeconfig),
  });
  if (patch.length === 0) {
    return;
  }
  await patchAp(kubeconfig, claim, patch);
}

export async function applyApReplicas(
  kubeconfig: string,
  claim: Record<string, unknown>,
  replicas: number
): Promise<void> {
  const n = validateApFixedReplicas(replicas);
  const spec = asRecord(claim.spec);
  await patchAp(
    kubeconfig,
    claim,
    patchOpsForApReplicaStrategySettings(spec, canonicalFixedReplicaStrategy(n))
  );
}

export async function applyApReplicaStrategy(
  kubeconfig: string,
  claim: Record<string, unknown>,
  replicaStrategy: ApReplicaStrategy
): Promise<void> {
  const spec = asRecord(claim.spec);
  await patchAp(
    kubeconfig,
    claim,
    patchOpsForApReplicaStrategySettings(spec, replicaStrategy)
  );
}

function parseEffectiveApSnapshotYaml(
  yamlText: string
): Record<string, unknown> {
  const doc = parseYaml(yamlText);
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("Snapshot config.yaml must be a YAML mapping.");
  }
  return doc as Record<string, unknown>;
}

/**
 * Applies effective fields from an orphaned snapshot (`config.yaml` in `{ap}-config-snapshot-{hash}`).
 */
export async function rollbackApFromEffectiveConfigYaml(
  kubeconfig: string,
  claim: Record<string, unknown>,
  yamlText: string
): Promise<void> {
  const snap = parseEffectiveApSnapshotYaml(yamlText.trim());
  const spec = asRecord(claim.spec);

  const resource = asRecord(snap.resource);
  if (resource != null) {
    const replicas = resource.replicas;
    if (replicas != null) {
      const n = Math.round(Number(replicas));
      if (!Number.isFinite(n) || n < 0 || n > 20) {
        throw new Error("Snapshot replicas must be between 0 and 20.");
      }
    }
  }

  const input = asRecord(snap.input);
  if (input != null) {
    const image = input.image;
    if (image != null && (typeof image !== "string" || image.trim() === "")) {
      throw new Error("Snapshot is missing a valid image.");
    }
  }

  const ops = patchOpsFromEffectiveSnapshot(spec, snap);

  if (ops.length === 0) {
    throw new Error("Snapshot did not contain any applicable spec fields.");
  }

  await patchAp(kubeconfig, claim, ops);
}
