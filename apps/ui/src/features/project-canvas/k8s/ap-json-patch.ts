import type {
  ContainerEnvVar,
  ContainerNetwork,
} from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import {
  CONTAINER_ENV_VALUE_FROM_PLACEHOLDER,
  containerEnvRowsEqual,
  normalizeContainerEnvRowsForSave,
  validateContainerEnvRows,
} from "@workspace/ui/lib/container-env-rows";
import { parse as parseYaml } from "yaml";

import {
  isRoutingDomainLabelValue,
  routingDomainFromKubeconfig,
} from "@/lib/kubeconfig-routing-domain";
import {
  CUSTOM_DOMAIN_BINDING_ID_PATTERN,
  generatePlatformAddressId,
  isCustomDomainBindingId,
  isPlatformAddressId,
  normalizeCustomDomainBindingId,
  normalizePlatformAddressId,
  PLATFORM_ADDRESS_ID_PATTERN,
} from "../platform-addresses";
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
import {
  type ExistingCustomDomainBinding,
  normalizeCustomDomainName,
} from "./entrypoint-custom-domains";
import { type K8sJsonPatchOp, k8sJsonPatchResource } from "./http/json-patch";

const AP_K8S_KIND = "aps";
const LEGACY_AP_NETWORK_INPUT_FIELDS = ["endpoints", "port", "host"] as const;

type ApNetworkSettingsPatch = Pick<ContainerNetwork, "privatePort"> &
  Partial<{
    customDomains: readonly NonNullable<
      ContainerNetwork["customDomains"]
    >[number][];
    publicAddresses: readonly ContainerNetwork["publicAddresses"][number][];
  }>;

type ApPrivatePortSettingsPatch = Pick<ContainerNetwork, "privatePort">;

type ApPublicAddressesSettingsPatch = Pick<
  ContainerNetwork,
  "publicAddresses"
> & {
  customDomains?: readonly NonNullable<
    ContainerNetwork["customDomains"]
  >[number][];
  publicAddresses: readonly ContainerNetwork["publicAddresses"][number][];
};

interface ApNetworkSettingsPatchOptions {
  existingCustomDomains?: readonly ExistingCustomDomainBinding[];
  metadata?: Record<string, unknown>;
  routingDomain?: string;
}

export interface ApSettingsDraftPatch {
  cpuCores?: number;
  env?: readonly ContainerEnvVar[];
  image?: string;
  memoryMib?: number;
  network?: ApNetworkSettingsPatch;
  replicaStrategy?: ApReplicaStrategy;
  replicas?: number;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function assertApClaimForPatch(
  kubeconfig: string,
  claim: Record<string, unknown>
): { name: string; namespace: string } {
  const trimmedKc = kubeconfig.trim();
  if (trimmedKc === "") {
    throw new Error("Kubeconfig is missing.");
  }
  const kind =
    typeof claim.kind === "string" ? claim.kind.trim().toUpperCase() : "";
  if (kind !== "AP") {
    throw new Error("Only AP claims can be patched from container settings.");
  }
  const meta = asRecord(claim.metadata);
  const name = typeof meta?.name === "string" ? meta.name.trim() : "";
  const namespace =
    typeof meta?.namespace === "string" ? meta.namespace.trim() : "";
  if (name === "" || namespace === "") {
    throw new Error("AP claim must have metadata.name and metadata.namespace.");
  }
  return { name, namespace };
}

async function patchAp(
  kubeconfig: string,
  claim: Record<string, unknown>,
  ops: K8sJsonPatchOp[]
): Promise<void> {
  const { name, namespace } = assertApClaimForPatch(kubeconfig, claim);
  await k8sJsonPatchResource(kubeconfig, {
    kind: AP_K8S_KIND,
    name,
    namespace,
    patch: ops,
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
  edited: ContainerEnvVar[]
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
    if (e.value === CONTAINER_ENV_VALUE_FROM_PLACEHOLDER) {
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

function publicAddressesEqual(
  a: readonly ContainerNetwork["publicAddresses"][number][] | undefined,
  b: readonly ContainerNetwork["publicAddresses"][number][] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((address, index) => {
    const other = right[index];
    return (
      other != null &&
      normalizePlatformAddressId(address.id) ===
        normalizePlatformAddressId(other.id) &&
      Math.round(address.port) === Math.round(other.port)
    );
  });
}

function customDomainsEqual(
  a:
    | readonly NonNullable<ContainerNetwork["customDomains"]>[number][]
    | undefined,
  b:
    | readonly NonNullable<ContainerNetwork["customDomains"]>[number][]
    | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((domain, index) => {
    const other = right[index];
    return (
      other != null &&
      normalizeCustomDomainBindingId(domain.id) ===
        normalizeCustomDomainBindingId(other.id) &&
      domain.domain.trim().toLowerCase() ===
        other.domain.trim().toLowerCase() &&
      normalizePlatformAddressId(domain.platformAddressId) ===
        normalizePlatformAddressId(other.platformAddressId)
    );
  });
}

function apNetworksEqual(
  a: ApNetworkSettingsPatch | undefined,
  b: ApNetworkSettingsPatch | undefined
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return (
    Math.round(a.privatePort) === Math.round(b.privatePort) &&
    publicAddressesEqual(a.publicAddresses, b.publicAddresses) &&
    customDomainsEqual(a.customDomains, b.customDomains)
  );
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
  const privatePort = validatedNetworkPort(
    network.privatePort,
    "Private Address target port"
  );
  const platformAddresses = validatedPlatformAddresses(network.publicAddresses);
  const customDomains = validatedCustomDomains(
    network.customDomains,
    platformAddresses,
    options
  );
  const networkInput: Record<string, unknown> = { privatePort };
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

export function patchOpsForApPrivatePortSettings(
  spec: Record<string, unknown> | undefined,
  network: ApPrivatePortSettingsPatch
): K8sJsonPatchOp[] {
  const privatePort = validatedNetworkPort(
    network.privatePort,
    "Private Address target port"
  );
  const input = asRecord(spec?.input);
  const inputNetwork = asRecord(readApInput(spec ?? {}).network);
  const ops =
    inputNetwork == null
      ? patchOpsForApInput(spec, { network: { privatePort } })
      : [
          {
            op: Object.hasOwn(inputNetwork, "privatePort") ? "replace" : "add",
            path: "/spec/input/network/privatePort",
            value: privatePort,
          } satisfies K8sJsonPatchOp,
        ];
  removeExistingApInputFields(ops, input, LEGACY_AP_NETWORK_INPUT_FIELDS);
  return ops;
}

function networkInputFieldPatch(
  network: Record<string, unknown>,
  field: "customDomains" | "platformAddresses",
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

  const platformAddresses =
    validatedPlatformAddresses(network.publicAddresses) ?? [];
  const customDomains =
    validatedCustomDomains(network.customDomains, platformAddresses, options) ??
    [];
  const ops = [
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
  env: ContainerEnvVar[]
): K8sJsonPatchOp[] {
  const normalized = normalizeContainerEnvRowsForSave(env);
  const validation = validateContainerEnvRows(normalized);
  if (!validation.valid) {
    throw new Error(validation.errors[0]?.message ?? "Invalid environment.");
  }
  const list = buildEnvArray(readApInput(spec ?? {}).env, normalized);
  return patchOpsForApInput(spec, { env: list });
}

function validatedNetworkPort(port: number, label: string): number {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65_535) {
    throw new Error(`${label} must be an integer from 1 through 65535.`);
  }
  return n;
}

function validatedPlatformAddresses(
  publicAddresses:
    | readonly ContainerNetwork["publicAddresses"][number][]
    | undefined
): Record<string, unknown>[] | undefined {
  if (publicAddresses == null) {
    return undefined;
  }
  const seenIds = new Set<string>();
  return publicAddresses.map((address) => {
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
    return {
      id,
      port: validatedNetworkPort(address.port, "Public Address target port"),
    };
  });
}

function validatedCustomDomains(
  customDomains:
    | readonly NonNullable<ContainerNetwork["customDomains"]>[number][]
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

    return { domain, id, platformAddressId };
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

  if (
    next.env !== undefined &&
    !containerEnvRowsEqual([...next.env], [...(previous.env ?? [])])
  ) {
    const normalized = normalizeContainerEnvRowsForSave([...next.env]);
    const validation = validateContainerEnvRows(normalized);
    if (!validation.valid) {
      throw new Error(validation.errors[0]?.message ?? "Invalid environment.");
    }
    inputPatch.env = buildEnvArray(readApInput(spec ?? {}).env, normalized);
  }

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
  env: ContainerEnvVar[]
): Promise<void> {
  const spec = asRecord(claim.spec);
  await patchAp(kubeconfig, claim, patchOpsForApEnvSettings(spec, env));
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
  options: Pick<ApNetworkSettingsPatchOptions, "existingCustomDomains"> = {}
): Promise<void> {
  const spec = asRecord(claim.spec);
  const patch = patchOpsForApSettingsDraft(spec, next, previous, {
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
