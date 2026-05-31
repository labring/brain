import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type {
  ContainerEnvVar,
  ContainerNetwork,
  ContainerPort,
} from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import { clampScale } from "@workspace/ui/components/scale-slider/scale-slider.utils";
import {
  CONTAINER_ENV_VALUE_FROM_PLACEHOLDER,
  type ContainerEnvDbDsnSource,
  containerEnvDbDsnReferenceFromValue,
  containerEnvDbSecretReferenceFromValueFrom,
} from "@workspace/ui/lib/container-env-rows";

import {
  customDomainBindingIdFromValue,
  platformAddressEndpoint,
  platformAddressIdFromValue,
  platformAddressIdsFromRows,
} from "../platform-addresses";
import {
  type ApReplicaStrategy,
  defaultFixedReplicaStrategy,
  normalizeApFixedReplicas,
} from "./ap-replica-strategy";
import {
  readApCpuLimit,
  readApEnv,
  readApImage,
  readApInput,
  readApMemoryLimit,
  readApReplicaStrategy,
} from "./ap-spec-access";
import {
  entryPointCustomDomainStatusesForAp,
  normalizeCustomDomainName,
} from "./entrypoint-custom-domains";

export type WorkloadClaimKind = "AP" | "DB";
type ContainerCustomDomain = NonNullable<
  ContainerNetwork["customDomains"]
>[number];
type CustomDomainReadModelPatch = Partial<ContainerCustomDomain>;
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
  dbDsnReferenceSources: readonly ContainerEnvDbDsnSource[] = []
): ContainerEnvVar[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ContainerEnvVar[] = [];
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
        ...(containerEnvDbDsnReferenceFromValue(
          e.value,
          dbDsnReferenceSources
        ) ?? { value: e.value }),
      });
    } else if (e.valueFrom != null) {
      out.push({
        name,
        ...(containerEnvDbSecretReferenceFromValueFrom(
          e.valueFrom,
          dbDsnReferenceSources
        ) ?? {
          value: CONTAINER_ENV_VALUE_FROM_PLACEHOLDER,
          valueFrom: e.valueFrom,
          valueSource: "valueFrom",
        }),
      });
    }
  }
  return out;
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
  options?: ClaimToContainerSettingsOptions
): ContainerNetwork | undefined {
  const inputNetwork = asRecord(readApInput(spec).network);
  const statusNetwork = asRecord(status.network);
  const privatePort =
    privatePortNum(statusNetwork?.privatePort) ??
    privatePortNum(inputNetwork?.privatePort);
  if (privatePort == null) {
    return undefined;
  }
  const privateAddress = trimStr(statusNetwork?.privateAddress);
  const entryPointCustomDomains = entryPointCustomDomainStatusesForAp(
    options?.entryPointsData,
    metadata ?? {}
  );
  return {
    ...(privateAddress === "" ? {} : { privateAddress }),
    ...apNetworkCustomDomains(
      inputNetwork,
      statusNetwork,
      entryPointCustomDomains
    ),
    privatePort,
    publicAddresses: apNetworkPublicAddresses(
      metadata,
      inputNetwork,
      statusNetwork
    ),
  };
}

function apNetworkCustomDomains(
  inputNetwork: Record<string, unknown> | undefined,
  statusNetwork: Record<string, unknown> | undefined,
  entryPointCustomDomains: ReadonlyMap<string, ContainerCustomDomain>
): Pick<ContainerNetwork, "customDomains"> | Record<string, never> {
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
  statusNetwork: Record<string, unknown> | undefined
): ContainerNetwork["publicAddresses"] {
  const observed = normalizeNetworkPublicAddresses(
    statusNetwork?.publicAddresses,
    true
  ).filter(isPlatformPublicAddressRow);
  const desiredPending = normalizeDesiredPlatformAddresses(
    inputNetwork?.platformAddresses,
    metadata,
    apRoutingDomainFromMetadata(metadata)
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

function isCustomPublicAddressRow(
  address: ContainerNetwork["publicAddresses"][number]
): boolean {
  return address.type?.trim().toLowerCase() === "custom";
}

function isPlatformPublicAddressRow(
  address: ContainerNetwork["publicAddresses"][number]
): boolean {
  return !isCustomPublicAddressRow(address);
}

function normalizeDesiredCustomDomains(
  raw: unknown,
  projectedCustomDomains: CustomDomainReadModelById = new Map(),
  entryPointCustomDomains: ReadonlyMap<
    string,
    ContainerCustomDomain
  > = new Map()
): NonNullable<ContainerNetwork["customDomains"]> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: NonNullable<ContainerNetwork["customDomains"]> = [];
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
  desired: Pick<ContainerCustomDomain, "domain" | "id" | "platformAddressId">,
  projected: CustomDomainReadModelPatch | undefined,
  entryPoint: ContainerCustomDomain | undefined
): ContainerCustomDomain {
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
    const status = trimStr(row.status);
    const targetPort = privatePortNum(row.port);
    out.set(id, {
      ...(cnameTarget === "" ? {} : { cnameTarget }),
      ...(domain === "" ? {} : { domain }),
      ...(platformAddressId === undefined ? {} : { platformAddressId }),
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
): ContainerNetwork["publicAddresses"] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const namespace = trimStr(metadata?.namespace);
  const appName = trimStr(metadata?.name);
  const out: ContainerNetwork["publicAddresses"] = [];
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
): ContainerNetwork["publicAddresses"] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: ContainerNetwork["publicAddresses"] = [];
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
): ContainerNetwork["publicAddresses"][number] | undefined {
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
  const normalized: ContainerNetwork["publicAddresses"][number] = {
    ...(host === "" ? {} : { host }),
    ...(id === "" ? {} : { id }),
    port,
  };
  if (!includeObservedFields) {
    return normalized;
  }
  const status = trimStr(address.status);
  const type = trimStr(address.type);
  const url = trimStr(address.url);
  return {
    ...normalized,
    ...(status === "" ? {} : { status }),
    ...(type === "" ? {} : { type }),
    ...(url === "" ? {} : { url }),
  };
}

export interface ClaimContainerSettings {
  cpuCores: number;
  env: ContainerEnvVar[];
  image: string;
  memoryMib: number;
  network?: ContainerNetwork;
  ports: ContainerPort[];
  replicaStrategy: ApReplicaStrategy;
  /** AP fixed replicas (1–20 in UI); legacy `spec.resource.replicas` is a fallback only. */
  replicas: number;
}

const CPU_MIN = 0.25;
const CPU_MAX = 16;
const MEM_MIN = 512;
const MEM_MAX = 8192;
export interface ClaimToContainerSettingsOptions {
  dbDsnReferenceSources?: ContainerEnvDbDsnSource[];
  entryPointsData?: K8sGetResponse;
}

function mapApClaim(
  metadata: Record<string, unknown>,
  spec: Record<string, unknown>,
  status: Record<string, unknown>,
  options?: ClaimToContainerSettingsOptions
): ClaimContainerSettings {
  const image = readApImage(spec) ?? "—";
  const cpuRaw = parseCpuToCores(readApCpuLimit(spec));
  const memRaw = parseMemoryToMib(readApMemoryLimit(spec));
  const cpuCores = clampScale(cpuRaw ?? 1, CPU_MIN, CPU_MAX);
  const memoryMib = clampScale(memRaw ?? 512, MEM_MIN, MEM_MAX);
  const replicaStrategy = readApReplicaStrategy(spec);
  const replicas = normalizeApFixedReplicas(replicaStrategy.fixed.replicas);
  return {
    cpuCores,
    env: envFromSpecEnvList(readApEnv(spec), options?.dbDsnReferenceSources),
    image,
    memoryMib,
    network: apNetworkFromSpecAndStatus(metadata, spec, status, options),
    ports: [],
    replicaStrategy,
    replicas,
  };
}

function mapDbSpec(spec: Record<string, unknown>): ClaimContainerSettings {
  const engine =
    typeof spec.engine === "string" && spec.engine.trim() !== ""
      ? spec.engine.trim()
      : "database";
  const cpuRaw = parseCpuToCores(spec.cpuLimit);
  const memRaw = parseMemoryToMib(spec.memoryLimit);
  return {
    cpuCores: clampScale(cpuRaw ?? 1, CPU_MIN, CPU_MAX),
    env: [],
    image: engine,
    memoryMib: clampScale(memRaw ?? 512, MEM_MIN, MEM_MAX),
    ports: [],
    replicaStrategy: defaultFixedReplicaStrategy(),
    replicas: 1,
  };
}

export function claimToContainerSettings(
  claim: Record<string, unknown> | undefined,
  workloadKind: WorkloadClaimKind,
  options?: ClaimToContainerSettingsOptions
): ClaimContainerSettings {
  if (claim == null) {
    return {
      cpuCores: 1,
      env: [],
      image: "",
      memoryMib: 512,
      ports: [],
      replicaStrategy: defaultFixedReplicaStrategy(),
      replicas: 1,
    };
  }
  const spec = asRecord(claim.spec) ?? {};
  const status = asRecord(claim.status) ?? {};
  const metadata = asRecord(claim.metadata) ?? {};
  return workloadKind === "DB"
    ? mapDbSpec(spec)
    : mapApClaim(metadata, spec, status, options);
}
