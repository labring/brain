import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { clampScale } from "@workspace/ui/components/settings-slider/settings-slider.utils";
import type {
  ApConfigMapMount,
  ApEnvVar,
  ApNetwork,
  ApStorageMount,
  ApWorkloadKind,
} from "@/features/project-settings/ap/ap-settings-sections";
import {
  apEnvRawSourceFromRows,
  apEnvRawSourceRows,
} from "@/features/project-settings/ap/lib/ap-env-raw-source";
import {
  AP_ENV_VALUE_FROM_PLACEHOLDER,
  type ApEnvDbDsnSource,
  apEnvDbDsnReferenceFromValue,
  apEnvDbSecretReferenceFromValueFrom,
} from "@/features/project-settings/ap/lib/ap-env-rows";
import { apEnvRowsFromSavedEnv } from "@/features/project-settings/ap/lib/ap-env-tokens";

import {
  customDomainBindingIdFromValue,
  platformAddressEndpoint,
  platformAddressIdFromValue,
  platformAddressIdsFromRows,
} from "@/features/project-settings/ap/lib/platform-address";
import {
  type ApReplicaStrategy,
  defaultFixedReplicaStrategy,
  normalizeApFixedReplicas,
} from "./ap-replica-strategy";
import {
  readApCpuLimit,
  readApImage,
  readApInput,
  readApMemoryLimit,
  readApReplicaStrategy,
} from "./ap-spec-access";
import {
  entryPointCustomDomainStatusesForAp,
  entryPointPublicAddressStatusesForAp,
  normalizeCustomDomainName,
} from "./entrypoint-custom-domains";

export type WorkloadClaimKind = "AP" | "DB";
type ApClaimCustomDomain = NonNullable<ApNetwork["customDomains"]>[number];
type CustomDomainReadModelPatch = Partial<ApClaimCustomDomain>;
type CustomDomainReadModelById = ReadonlyMap<
  string,
  CustomDomainReadModelPatch
>;

const MEM_SUFFIX_GI = /^([0-9]+(?:\.[0-9]+)?)gi$/i;
const MEM_SUFFIX_MI = /^([0-9]+(?:\.[0-9]+)?)mi$/i;
const MEM_SUFFIX_G = /^([0-9]+(?:\.[0-9]+)?)g$/i;
const MEM_SUFFIX_M = /^([0-9]+(?:\.[0-9]+)?)m$/i;

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/**
 * Huma may wrap `json.RawMessage` as `{ "body": { ...resource } }`. Lists stay at top level or under body.
 */
function unwrapK8sSinglePayload(
  data: Record<string, unknown>
): Record<string, unknown> {
  if (
    asRecord(data.metadata) != null ||
    asRecord(data.spec) != null ||
    Array.isArray(data.items)
  ) {
    return data;
  }
  const lower = asRecord(data.body);
  if (lower != null) {
    return lower;
  }
  const upper = asRecord(data.Body);
  if (upper != null) {
    return upper;
  }
  return data;
}

/** Single-object body from `GET /api/k8s/.../get` (not a list). */
export function k8sGetClaimBody(
  data: K8sGetResponse | undefined
): Record<string, unknown> | undefined {
  if (data == null || typeof data !== "object") {
    return undefined;
  }
  const o = unwrapK8sSinglePayload(data as Record<string, unknown>);
  if (Array.isArray(o.items)) {
    return undefined;
  }
  if (asRecord(o.metadata) == null && asRecord(o.spec) == null) {
    return undefined;
  }
  return o;
}

/** Kubernetes cpu quantity → v cores (e.g. `500m` → 0.5, `2` → 2). */
export function parseCpuToCores(q: unknown): number | undefined {
  if (typeof q !== "string" || q.trim() === "") {
    return undefined;
  }
  const s = q.trim();
  if (s.endsWith("m")) {
    const n = Number(s.slice(0, -1));
    return Number.isFinite(n) ? n / 1000 : undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Kubernetes memory quantity → MiB (integer), common suffixes only. */
export function parseMemoryToMib(q: unknown): number | undefined {
  if (typeof q !== "string" || q.trim() === "") {
    return undefined;
  }
  const s = q.trim();
  const lower = s.toLowerCase();
  const gi = MEM_SUFFIX_GI.exec(lower);
  if (gi) {
    return Math.round(Number(gi[1]) * 1024);
  }
  const mi = MEM_SUFFIX_MI.exec(lower);
  if (mi) {
    return Math.round(Number(mi[1]));
  }
  const g = MEM_SUFFIX_G.exec(lower);
  if (g) {
    return Math.round(Number(g[1]) * 1000);
  }
  const m = MEM_SUFFIX_M.exec(lower);
  if (m) {
    return Math.max(1, Math.round(Number(m[1]) / (1024 * 1024)));
  }
  const plain = Number(s);
  return Number.isFinite(plain) ? Math.round(plain) : undefined;
}

function envFromSpecEnvList(
  raw: unknown,
  dbDsnReferenceSources: readonly ApEnvDbDsnSource[] = []
): ApEnvVar[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ApEnvVar[] = [];
  for (const item of raw) {
    const e = asRecord(item);
    if (e == null) {
      continue;
    }
    const name = e.name;
    if (typeof name !== "string" || name === "") {
      continue;
    }
    if (typeof e.value === "string") {
      out.push({
        name,
        ...(apEnvDbDsnReferenceFromValue(e.value, dbDsnReferenceSources) ?? {
          value: e.value,
        }),
      });
    } else if (e.valueFrom != null) {
      out.push({
        name,
        ...(apEnvDbSecretReferenceFromValueFrom(
          e.valueFrom,
          dbDsnReferenceSources
        ) ?? {
          value: AP_ENV_VALUE_FROM_PLACEHOLDER,
          valueFrom: e.valueFrom,
          valueSource: "valueFrom",
        }),
      });
    }
  }
  return apEnvRowsFromSavedEnv(out, dbDsnReferenceSources);
}

function envRawSourceFromSpecInput(
  input: Record<string, unknown>,
  fallbackEnv: readonly ApEnvVar[]
): string {
  return typeof input.envRawSource === "string"
    ? input.envRawSource
    : apEnvRawSourceFromRows(fallbackEnv);
}

function portNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) {
    return v;
  }
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function privatePortNum(v: unknown): number | undefined {
  const n = portNum(v);
  if (n == null || !Number.isInteger(n) || n < 1 || n > 65_535) {
    return undefined;
  }
  return n;
}

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function stringListFromSpec(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string");
}

function configMapsFromSpecInput(raw: unknown): ApConfigMapMount[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ApConfigMapMount[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    const path = trimStr(row?.path);
    const value = typeof row?.value === "string" ? row.value : "";
    if (path === "" && value === "") {
      continue;
    }
    out.push({ path, value });
  }
  return out;
}

function storageFromSpecInput(raw: unknown): ApStorageMount[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ApStorageMount[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    const path = trimStr(row?.path);
    const size = trimStr(row?.size);
    if (path === "" && size === "") {
      continue;
    }
    out.push({ path, size });
  }
  return out;
}

function apWorkloadKindFromSpec(spec: Record<string, unknown>): ApWorkloadKind {
  const workload = asRecord(spec.workload);
  return trimStr(workload?.kind).toLowerCase() === "statefulset"
    ? "statefulset"
    : "deployment";
}

function apRoutingDomainFromMetadata(
  metadata: Record<string, unknown> | undefined
): string {
  const labels = asRecord(metadata?.labels);
  return trimStr(labels?.region);
}

function apNetworkFromSpecAndStatus(
  metadata: Record<string, unknown> | undefined,
  spec: Record<string, unknown>,
  status: Record<string, unknown>,
  options?: ClaimToApSettingsOptions
): ApNetwork | undefined {
  const inputNetwork = asRecord(readApInput(spec).network);
  const statusNetwork = asRecord(status.network);
  const appListeningPorts = normalizeNetworkAppListeningPorts(
    statusNetwork,
    inputNetwork
  );
  const primaryPort = appListeningPorts[0]?.port;
  if (primaryPort == null) {
    return undefined;
  }
  const privateAddress =
    appListeningPorts[0]?.privateAddress ??
    trimStr(statusNetwork?.privateAddress);
  const entryPointCustomDomains = entryPointCustomDomainStatusesForAp(
    options?.entryPointsData,
    metadata ?? {}
  );
  const entryPointPublicAddresses = entryPointPublicAddressStatusesForAp(
    options?.entryPointsData,
    metadata ?? {}
  );
  return {
    appListeningPorts,
    ...(privateAddress === "" ? {} : { privateAddress }),
    ...apNetworkCustomDomains(
      inputNetwork,
      statusNetwork,
      entryPointCustomDomains
    ),
    privatePort: primaryPort,
    publicAddresses: apNetworkPublicAddresses(
      metadata,
      inputNetwork,
      statusNetwork,
      entryPointPublicAddresses
    ),
  };
}

function normalizeNetworkAppListeningPorts(
  statusNetwork: Record<string, unknown> | undefined,
  inputNetwork: Record<string, unknown> | undefined
): NonNullable<ApNetwork["appListeningPorts"]> {
  const fromStatus = normalizeAppListeningPortRows(
    statusNetwork?.appListeningPorts,
    true
  );
  if (fromStatus.length > 0) {
    return fromStatus;
  }
  const fromInput = normalizeAppListeningPortRows(
    inputNetwork?.appListeningPorts,
    false
  );
  if (fromInput.length > 0) {
    return fromInput;
  }
  const legacyPort =
    privatePortNum(statusNetwork?.privatePort) ??
    privatePortNum(inputNetwork?.privatePort);
  if (legacyPort == null) {
    return [];
  }
  const legacyPrivateAddress = trimStr(statusNetwork?.privateAddress);
  return [
    {
      ...(legacyPrivateAddress === ""
        ? {}
        : { privateAddress: legacyPrivateAddress }),
      port: legacyPort,
    },
  ];
}

function normalizeAppListeningPortRows(
  raw: unknown,
  includeObservedFields: boolean
): NonNullable<ApNetwork["appListeningPorts"]> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: NonNullable<ApNetwork["appListeningPorts"]> = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const row = asRecord(item);
    const port = privatePortNum(row?.port);
    if (row == null || port == null || seen.has(port)) {
      continue;
    }
    seen.add(port);
    const privateAddress = trimStr(row.privateAddress);
    out.push({
      ...(includeObservedFields && privateAddress !== ""
        ? { privateAddress }
        : {}),
      port,
    });
  }
  return out;
}

function apNetworkCustomDomains(
  inputNetwork: Record<string, unknown> | undefined,
  statusNetwork: Record<string, unknown> | undefined,
  entryPointCustomDomains: ReadonlyMap<string, ApClaimCustomDomain>
): Pick<ApNetwork, "customDomains"> | Record<string, never> {
  const customDomains = normalizeDesiredCustomDomains(
    inputNetwork?.customDomains,
    projectedCustomDomainsById(statusNetwork?.publicAddresses),
    entryPointCustomDomains
  );
  return customDomains.length === 0 ? {} : { customDomains };
}

function apNetworkPublicAddresses(
  metadata: Record<string, unknown> | undefined,
  inputNetwork: Record<string, unknown> | undefined,
  statusNetwork: Record<string, unknown> | undefined,
  entryPointPublicAddresses: ReadonlyMap<
    string,
    Pick<ApNetwork["publicAddresses"][number], "status">
  >
): ApNetwork["publicAddresses"] {
  const observed = normalizeNetworkPublicAddresses(
    statusNetwork?.publicAddresses,
    true
  )
    .filter(isPlatformPublicAddressRow)
    .map((address) =>
      mergePublicAddressStatus(address, entryPointPublicAddresses)
    );
  const desiredPending = normalizeDesiredPlatformAddresses(
    inputNetwork?.platformAddresses,
    metadata,
    apRoutingDomainFromMetadata(metadata)
  ).map((address) =>
    mergePublicAddressStatus(address, entryPointPublicAddresses)
  );
  if (observed.length > 0) {
    const observedIds = platformAddressIdsFromRows(observed);
    return [
      ...observed,
      ...desiredPending.filter(
        (address) => address.id === undefined || !observedIds.has(address.id)
      ),
    ];
  }
  return desiredPending;
}

function mergePublicAddressStatus(
  address: ApNetwork["publicAddresses"][number],
  entryPointPublicAddresses: ReadonlyMap<
    string,
    Pick<ApNetwork["publicAddresses"][number], "status">
  >
): ApNetwork["publicAddresses"][number] {
  if (address.id === undefined) {
    return address;
  }
  return {
    ...address,
    ...entryPointPublicAddresses.get(address.id),
  };
}

function isCustomPublicAddressRow(
  address: ApNetwork["publicAddresses"][number]
): boolean {
  return address.type?.trim().toLowerCase() === "custom";
}

function isPlatformPublicAddressRow(
  address: ApNetwork["publicAddresses"][number]
): boolean {
  return !isCustomPublicAddressRow(address);
}

function normalizeDesiredCustomDomains(
  raw: unknown,
  projectedCustomDomains: CustomDomainReadModelById = new Map(),
  entryPointCustomDomains: ReadonlyMap<string, ApClaimCustomDomain> = new Map()
): NonNullable<ApNetwork["customDomains"]> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: NonNullable<ApNetwork["customDomains"]> = [];
  for (const item of raw) {
    const binding = asRecord(item);
    if (binding == null) {
      continue;
    }
    const id = customDomainBindingIdFromValue(binding.id);
    const platformAddressId = platformAddressIdFromValue(
      binding.platformAddressId
    );
    const domain = normalizeCustomDomainName(binding.domain);
    if (id === undefined || platformAddressId === undefined || domain === "") {
      continue;
    }
    out.push(
      mergedCustomDomainReadModel(
        { domain, id, platformAddressId },
        projectedCustomDomains.get(id),
        entryPointCustomDomains.get(id)
      )
    );
  }
  return out;
}

function mergedCustomDomainReadModel(
  desired: Pick<ApClaimCustomDomain, "domain" | "id" | "platformAddressId">,
  projected: CustomDomainReadModelPatch | undefined,
  entryPoint: ApClaimCustomDomain | undefined
): ApClaimCustomDomain {
  const observed = {
    status: "pending",
    ...projected,
    ...entryPoint,
  };
  return {
    ...observed,
    domain: entryPoint?.domain ?? projected?.domain ?? desired.domain,
    id: desired.id,
    platformAddressId:
      entryPoint?.platformAddressId ??
      projected?.platformAddressId ??
      desired.platformAddressId,
  };
}

function projectedCustomDomainsById(raw: unknown): CustomDomainReadModelById {
  if (!Array.isArray(raw)) {
    return new Map();
  }
  const out = new Map<string, CustomDomainReadModelPatch>();
  for (const item of raw) {
    const row = asRecord(item);
    if (row == null || trimStr(row.type).toLowerCase() !== "custom") {
      continue;
    }
    const id = customDomainBindingIdFromValue(row.id);
    const platformAddressId = platformAddressIdFromValue(row.platformAddressId);
    const domain = normalizeCustomDomainName(row.host);
    if (id === undefined) {
      continue;
    }
    const cnameTarget = trimStr(row.cnameTarget);
    const reason = trimStr(row.reason);
    const status = trimStr(row.status);
    const targetPort = privatePortNum(row.port);
    out.set(id, {
      ...(cnameTarget === "" ? {} : { cnameTarget }),
      ...(domain === "" ? {} : { domain }),
      ...(platformAddressId === undefined ? {} : { platformAddressId }),
      ...(reason === "" ? {} : { reason }),
      ...(status === "" ? {} : { status }),
      ...(targetPort == null ? {} : { targetPort }),
    });
  }
  return out;
}

function normalizeDesiredPlatformAddresses(
  raw: unknown,
  metadata: Record<string, unknown> | undefined,
  routingDomain: string
): ApNetwork["publicAddresses"] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const namespace = trimStr(metadata?.namespace);
  const appName = trimStr(metadata?.name);
  const out: ApNetwork["publicAddresses"] = [];
  for (const item of raw) {
    const address = asRecord(item);
    if (address == null) {
      continue;
    }
    const id = platformAddressIdFromValue(address.id);
    const port = privatePortNum(address.port);
    if (id === undefined || port == null) {
      continue;
    }
    const endpoint = platformAddressEndpoint({
      appName,
      namespace,
      platformAddressId: id,
      routingDomain,
    });
    out.push({
      ...(endpoint ?? {}),
      id,
      port,
      status: "progressing",
      type: "platform",
    });
  }
  return out;
}

function normalizeNetworkPublicAddresses(
  raw: unknown,
  includeObservedFields: boolean
): ApNetwork["publicAddresses"] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ApNetwork["publicAddresses"] = [];
  for (const item of raw) {
    const address = normalizeNetworkPublicAddress(item, includeObservedFields);
    if (address != null) {
      out.push(address);
    }
  }
  return out;
}

function normalizeNetworkPublicAddress(
  raw: unknown,
  includeObservedFields: boolean
): ApNetwork["publicAddresses"][number] | undefined {
  const address = asRecord(raw);
  if (address == null) {
    return undefined;
  }
  const id = trimStr(address.id);
  const host = trimStr(address.host);
  const port = privatePortNum(address.port);
  if ((host === "" && id === "") || port == null) {
    return undefined;
  }
  const normalized: ApNetwork["publicAddresses"][number] = {
    ...(host === "" ? {} : { host }),
    ...(id === "" ? {} : { id }),
    port,
  };
  if (!includeObservedFields) {
    return normalized;
  }
  const status = trimStr(address.status);
  const reason = trimStr(address.reason);
  const type = trimStr(address.type);
  const url = trimStr(address.url);
  return {
    ...normalized,
    ...(reason === "" ? {} : { reason }),
    ...(status === "" ? {} : { status }),
    ...(type === "" ? {} : { type }),
    ...(url === "" ? {} : { url }),
  };
}

export interface ClaimApSettings {
  args: string[];
  command: string[];
  configMaps: ApConfigMapMount[];
  cpuCores: number;
  env: ApEnvVar[];
  envRawSource?: string;
  image: string;
  memoryMib: number;
  network?: ApNetwork;
  replicaStrategy: ApReplicaStrategy;
  /** AP fixed replicas (1–20 in UI); legacy `spec.resource.replicas` is a fallback only. */
  replicas: number;
  storage: ApStorageMount[];
  workloadKind: ApWorkloadKind;
}

const CPU_MIN = 0.25;
const CPU_MAX = 16;
const MEM_MIN = 512;
const MEM_MAX = 8192;
export interface ClaimToApSettingsOptions {
  dbDsnReferenceSources?: ApEnvDbDsnSource[];
  entryPointsData?: K8sGetResponse;
}

function mapApClaim(
  metadata: Record<string, unknown>,
  spec: Record<string, unknown>,
  status: Record<string, unknown>,
  options?: ClaimToApSettingsOptions
): ClaimApSettings {
  const image = readApImage(spec) ?? "—";
  const cpuRaw = parseCpuToCores(readApCpuLimit(spec));
  const memRaw = parseMemoryToMib(readApMemoryLimit(spec));
  const cpuCores = clampScale(cpuRaw ?? 1, CPU_MIN, CPU_MAX);
  const memoryMib = clampScale(memRaw ?? 512, MEM_MIN, MEM_MAX);
  const replicaStrategy = readApReplicaStrategy(spec);
  const replicas = normalizeApFixedReplicas(replicaStrategy.fixed.replicas);
  const input = readApInput(spec);
  const savedEnv = envFromSpecEnvList(
    input.env,
    options?.dbDsnReferenceSources
  );
  const envRawSource = envRawSourceFromSpecInput(input, savedEnv);
  return {
    args: stringListFromSpec(input.args),
    command: stringListFromSpec(input.command),
    configMaps: configMapsFromSpecInput(input.configMaps),
    cpuCores,
    env:
      typeof input.envRawSource === "string"
        ? apEnvRawSourceRows(envRawSource)
        : savedEnv,
    envRawSource,
    image,
    memoryMib,
    network: apNetworkFromSpecAndStatus(metadata, spec, status, options),
    replicaStrategy,
    replicas,
    storage: storageFromSpecInput(input.storage),
    workloadKind: apWorkloadKindFromSpec(spec),
  };
}

function mapDbSpec(spec: Record<string, unknown>): ClaimApSettings {
  const engine =
    typeof spec.engine === "string" && spec.engine.trim() !== ""
      ? spec.engine.trim()
      : "database";
  const cpuRaw = parseCpuToCores(spec.cpuLimit);
  const memRaw = parseMemoryToMib(spec.memoryLimit);
  return {
    args: [],
    command: [],
    configMaps: [],
    cpuCores: clampScale(cpuRaw ?? 1, CPU_MIN, CPU_MAX),
    env: [],
    envRawSource: "",
    image: engine,
    memoryMib: clampScale(memRaw ?? 512, MEM_MIN, MEM_MAX),
    replicaStrategy: defaultFixedReplicaStrategy(),
    replicas: 1,
    storage: [],
    workloadKind: "deployment",
  };
}

export function claimToApSettings(
  claim: Record<string, unknown> | undefined,
  workloadKind: WorkloadClaimKind,
  options?: ClaimToApSettingsOptions
): ClaimApSettings {
  if (claim == null) {
    return {
      args: [],
      command: [],
      configMaps: [],
      cpuCores: 1,
      env: [],
      envRawSource: "",
      image: "",
      memoryMib: 512,
      replicaStrategy: defaultFixedReplicaStrategy(),
      replicas: 1,
      storage: [],
      workloadKind: "deployment",
    };
  }
  const spec = asRecord(claim.spec) ?? {};
  const status = asRecord(claim.status) ?? {};
  const metadata = asRecord(claim.metadata) ?? {};
  return workloadKind === "DB"
    ? mapDbSpec(spec)
    : mapApClaim(metadata, spec, status, options);
}
