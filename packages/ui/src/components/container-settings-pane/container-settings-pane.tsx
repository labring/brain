"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { AppDialog } from "@workspace/ui/components/app-dialog";
import { AppIconButton } from "@workspace/ui/components/app-icon-button";
import { AppInput } from "@workspace/ui/components/app-input";
import { AppInputField } from "@workspace/ui/components/app-input-field";
import { Badge } from "@workspace/ui/components/badge";
import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import { Label } from "@workspace/ui/components/label";
import {
  ResourceSettingsDraftFooter,
  ResourceSettingsInset,
  ResourceSettingsSection,
} from "@workspace/ui/components/resource-settings/resource-settings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { SettingsSlider } from "@workspace/ui/components/settings-slider/settings-slider";
import { clampScale } from "@workspace/ui/components/settings-slider/settings-slider.utils";
import {
  SlidingToggle,
  type SlidingToggleOption,
} from "@workspace/ui/components/sliding-toggle";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  addContainerEnvRow,
  type ContainerEnvDbDsnReferenceTarget,
  type ContainerEnvDbDsnSource,
  type ContainerEnvDbReferenceField,
  type ContainerEnvRow,
  containerEnvDbDsnFieldOptions,
  containerEnvDbReferenceRowPatch,
  containerEnvRowsEqual,
  containerEnvRowsModelEqual,
  defaultContainerEnvDbReferenceRowName,
  validateContainerEnvRows,
} from "@workspace/ui/lib/container-env-rows";
import {
  buildContainerEnvTokenMenuItems,
  containerEnvDbSourceKey,
  containerEnvRowsFromSavedEnv,
  deleteContainerEnvTokenRow,
  type EnvTokenDiagnostic,
  insertContainerEnvTokenText,
  normalizeContainerEnvTokenRowsForSave,
  refreshContainerEnvTokenDraft,
  updateContainerEnvTokenRow,
} from "@workspace/ui/lib/container-env-tokens";
import {
  generateCustomDomainBindingId,
  generatePlatformAddressDomainPrefix,
  generatePlatformAddressId,
  platformAddressEndpoint,
} from "@workspace/ui/lib/platform-address";
import { parsePortNumberDigits } from "@workspace/ui/lib/port-number";
import { cn } from "@workspace/ui/lib/utils";
import {
  Braces,
  ChevronDown,
  Cpu,
  MemoryStick,
  Network,
  Plus,
  Save,
  Settings,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  applySettingsDraftBackingResult,
  commitSettingsDraftBackingState,
  createSettingsDraftBackingState,
  failSettingsDraftSave,
  keepEditingSettingsDraftBackingState,
  reloadSettingsDraftBackingState,
  syncSettingsDraftBackingState,
} from "../../lib/settings-draft-backing";
import type { SettingsLeaveGuardRegistration } from "../../lib/settings-leave-guard";

const CPU_QUOTA_DIRTY_EPS = 1e-9;
const REPLICA_LIMITS = { max: 20, min: 1 } as const;
const CPU_UTILIZATION_TARGET_LIMITS = { max: 100, min: 1 } as const;
const MEMORY_AVERAGE_TARGET_LIMITS = { max: 8192, min: 128 } as const;
const DEFAULT_CPU_UTILIZATION_TARGET_PERCENT = 80;
const DEFAULT_MEMORY_AVERAGE_TARGET_MIB = 512;
const MEMORY_AVERAGE_VALUE_RE = /^([1-9][0-9]*)(Mi|Gi)$/;

/** Quota sliders are controlled: parent owns `value` and receives `onValueChange`. */
export interface ContainerSettingsControlledQuotaProps {
  disabled?: boolean;
  max?: number;
  min?: number;
  onValueChange: (value: number) => void;
  /** Radix Slider step (`SettingsSlider.Root` defaults to `0.1` unless set). */
  step?: number;
  value: number;
}

/** @deprecated Prefer {@link ContainerSettingsControlledQuotaProps}; pane quotas are always controlled. */
export type ContainerSettingsQuotaSliderProps =
  ContainerSettingsControlledQuotaProps;

export interface ContainerEnvVar extends ContainerEnvRow {}

export interface ContainerNetworkPublicAddress {
  domainPrefix?: string;
  host?: string;
  id?: string;
  platformAddressId?: string;
  port: number;
  reason?: string;
  status?: string;
  type?: string;
  url?: string;
}

export interface ContainerNetworkCustomDomainDetail {
  message?: string;
  reason?: string;
  status?: string;
}

export interface ContainerNetworkCustomDomain {
  certificate?: ContainerNetworkCustomDomainDetail;
  cnameTarget?: string;
  dns?: ContainerNetworkCustomDomainDetail;
  domain: string;
  id: string;
  platformAddressId: string;
  reason?: string;
  routing?: ContainerNetworkCustomDomainDetail;
  status?: string;
  targetPort?: number;
}

export interface ContainerNetworkAppListeningPort {
  port: number;
  privateAddress?: string;
}

export interface ContainerNetwork {
  appListeningPorts?: ContainerNetworkAppListeningPort[];
  customDomains?: ContainerNetworkCustomDomain[];
  privateAddress?: string;
  privatePort: number;
  publicAddresses: ContainerNetworkPublicAddress[];
}

export interface ContainerNetworkPlatformAddressDraftContext {
  appName?: string;
  namespace?: string;
  routingDomain?: string;
}

export interface ContainerCustomDomainCnameVerificationResult {
  message?: string;
  ok: boolean;
  reason?: string;
}

export type ContainerCustomDomainCnameVerifier = (input: {
  domain: string;
  target: string;
}) => Promise<ContainerCustomDomainCnameVerificationResult>;

export interface ContainerFixedReplicaStrategy {
  elastic?: ContainerElasticReplicaSettings;
  fixed: {
    replicas: number;
  };
  type: "fixed";
}

export interface ContainerCpuElasticReplicaTarget {
  metric: "cpu";
  type: "utilization";
  utilizationPercent: number;
}

export interface ContainerMemoryElasticReplicaTarget {
  averageValue: string;
  metric: "memory";
  type: "averageValue";
}

export type ContainerElasticReplicaTarget =
  | ContainerCpuElasticReplicaTarget
  | ContainerMemoryElasticReplicaTarget;

export interface ContainerElasticReplicaSettings {
  maxReplicas: number;
  minReplicas: number;
  target: ContainerElasticReplicaTarget;
}

export interface ContainerElasticReplicaStrategy {
  elastic: ContainerElasticReplicaSettings;
  fixed: {
    replicas: number;
  };
  type: "elastic";
}

export type ContainerReplicaStrategy =
  | ContainerElasticReplicaStrategy
  | ContainerFixedReplicaStrategy;

type ReplicaStrategyType = ContainerReplicaStrategy["type"];
type ElasticTargetMetric = ContainerElasticReplicaTarget["metric"];

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
      <span className="inline-flex items-center gap-1.5">
        <Cpu aria-hidden className="size-3.5" />
        Target CPU
      </span>
    ),
    value: "cpu",
  },
  {
    ariaLabel: "Memory average target",
    label: (
      <span className="inline-flex items-center gap-1.5">
        <MemoryStick aria-hidden className="size-3.5" />
        Target Memory
      </span>
    ),
    value: "memory",
  },
] as const satisfies readonly SlidingToggleOption<ElasticTargetMetric>[];

interface ResourceQuotasDirtyReplicaStrategy {
  committed: ContainerReplicaStrategy;
  draft: ContainerReplicaStrategy;
}

interface ResourceQuotaReplicaPatch {
  replicaStrategy?: ContainerReplicaStrategy;
}

const DEFAULT_FIXED_REPLICAS: number = REPLICA_LIMITS.min;
const DEFAULT_ELASTIC_REPLICA_SETTINGS: ContainerElasticReplicaSettings = {
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

function normalizeReplicaCount(replicas: number): number {
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

function memoryAverageMibToValue(mib: number): string {
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

function cpuElasticTarget(
  utilizationPercent = DEFAULT_CPU_UTILIZATION_TARGET_PERCENT
): ContainerCpuElasticReplicaTarget {
  return {
    metric: "cpu",
    type: "utilization",
    utilizationPercent: normalizeCpuUtilizationTarget(utilizationPercent),
  };
}

function memoryElasticTarget(
  averageValue = `${DEFAULT_MEMORY_AVERAGE_TARGET_MIB}Mi`
): ContainerMemoryElasticReplicaTarget {
  return {
    averageValue: normalizeMemoryAverageTarget(averageValue),
    metric: "memory",
    type: "averageValue",
  };
}

function defaultElasticTargetForMetric(
  metric: ElasticTargetMetric
): ContainerElasticReplicaTarget {
  if (metric === "memory") {
    return memoryElasticTarget();
  }
  return cpuElasticTarget();
}

function normalizeElasticTarget(
  target: ContainerElasticReplicaSettings["target"] | undefined
): ContainerElasticReplicaTarget {
  if (target?.metric === "memory") {
    return memoryElasticTarget(target.averageValue);
  }
  return cpuElasticTarget(target?.utilizationPercent);
}

function normalizeFixedReplicaSettings(replicas: number): { replicas: number } {
  return { replicas: normalizeReplicaCount(replicas) };
}

function normalizeElasticReplicaSettings(
  settings: ContainerElasticReplicaSettings | undefined
): ContainerElasticReplicaSettings {
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

function normalizeReplicaStrategy(
  strategy: ContainerReplicaStrategy | undefined,
  fixedReplicas = DEFAULT_FIXED_REPLICAS
): ContainerReplicaStrategy {
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

function elasticSettingsFromStrategy(
  strategy: ContainerReplicaStrategy
): ContainerElasticReplicaSettings {
  if (strategy.type === "elastic") {
    return strategy.elastic;
  }
  return strategy.elastic ?? DEFAULT_ELASTIC_REPLICA_SETTINGS;
}

function replicaStrategiesEqual(
  a: ContainerReplicaStrategy,
  b: ContainerReplicaStrategy
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
  a: ContainerElasticReplicaTarget,
  b: ContainerElasticReplicaTarget
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

function replicaStrategyWithType(
  current: ContainerReplicaStrategy,
  type: ReplicaStrategyType
): ContainerReplicaStrategy {
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
  draftReplicaStrategy: ContainerReplicaStrategy
): ResourceQuotaReplicaPatch {
  if (!hasReplicasQuota) {
    return {};
  }
  return { replicaStrategy: draftReplicaStrategy };
}

function resourceQuotasDirty(
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

export interface ContainerSettingsPaneAddDbDsnReferenceIntent {
  dbName: string;
  dbNamespace: string;
  id: string;
}

export interface ContainerSettingsPaneConfirmedAddDbDsnReference {
  dbName: string;
  dbNamespace: string;
  id: string;
}

export interface ContainerSettingsPaneEnvChangeMeta {
  confirmedAddDbDsnReferences: ContainerSettingsPaneConfirmedAddDbDsnReference[];
}

export interface ContainerSettingsPaneAddDbDsnReferenceIntentChange {
  id: string;
  references: ContainerSettingsPaneConfirmedAddDbDsnReference[];
}

export interface ContainerSettingsDraft {
  cpuCores: number;
  env: readonly ContainerEnvVar[];
  image: string;
  memoryMib: number;
  network?: ContainerNetwork;
  replicaStrategy?: ContainerReplicaStrategy;
  replicas?: number;
}

export interface ContainerSettingsPaneSettingsDraftCommitMeta
  extends Partial<ContainerSettingsPaneEnvChangeMeta> {
  baseDraft: ContainerSettingsDraft;
}

export interface ContainerPublicAddressesSettingsDraftCommitMeta {
  baseNetwork: ContainerNetwork;
}

export interface ContainerSettingsPaneProps {
  /**
   * One-shot request from a Canvas Connecting Edge to append an environment row
   * with the dragged DB selected as transient Reference context.
   */
  addDbDsnReferenceIntent?: ContainerSettingsPaneAddDbDsnReferenceIntent | null;
  className?: string;
  cpuQuota: ContainerSettingsControlledQuotaProps;
  /** Project DB connection strings that can be saved into AP env values as DSN references. */
  dbDsnReferenceSources?: ContainerEnvDbDsnSource[];
  /** Environment variables shown and edited as structured rows. */
  env: ContainerEnvVar[];
  /** Full image reference (repository + tag/digest). */
  image: string;
  memoryQuota: ContainerSettingsControlledQuotaProps;
  /** AP network model rendered by the Network section. */
  network?: ContainerNetwork;
  networkPlatformAddressDraftContext?: ContainerNetworkPlatformAddressDraftContext;
  onAddDbDsnReferenceIntentConsumed?: (id: string) => void;
  onAddDbDsnReferenceIntentDraftChange?: (
    change: ContainerSettingsPaneAddDbDsnReferenceIntentChange
  ) => void;
  onCustomDomainCnameVerify?: ContainerCustomDomainCnameVerifier;
  onEnvChange: (
    env: ContainerEnvVar[],
    meta?: ContainerSettingsPaneEnvChangeMeta
  ) => void;
  onImageChange: (image: string) => void;
  onNetworkChange?: (network: ContainerNetwork) => void | Promise<void>;
  /**
   * When set (and not `readOnly`), CPU/memory/replicas sliders keep local drafts until Update; Discard reverts.
   * Omit for live slider updates via `cpuQuota` / `memoryQuota` / `replicasQuota` `onValueChange`.
   * When `replicasQuota` is set, the draft `replicaStrategy` is included on Update.
   */
  onResourceQuotasCommit?: (next: {
    cpu: number;
    memory: number;
    replicaStrategy?: ContainerReplicaStrategy;
    replicas?: number;
  }) => void | Promise<void>;
  /** Panel-level AP Settings Draft commit. When set, all editable controls save through one draft update. */
  onSettingsDraftCommit?: (
    draft: ContainerSettingsDraft,
    meta?: ContainerSettingsPaneSettingsDraftCommitMeta
  ) => void | Promise<void>;
  onSettingsDraftLeaveGuardChange?: SettingsLeaveGuardRegistration;
  /**
   * When true, image/env/network are view-only and quota sliders do not send updates.
   * Host may pass no-op callbacks.
   */
  readOnly?: boolean;
  /** AP replica behavior rendered as a mutually exclusive strategy control. */
  replicaStrategy?: ContainerReplicaStrategy;
  /**
   * Fixed AP replica count. Omit to hide the control (e.g. DB workloads).
   */
  replicasQuota?: ContainerSettingsControlledQuotaProps;
  /** Restrict the pane to one AP Settings section for focused entry points. */
  sectionFocus?: "all" | "environment";
  /** Hide the Image section when image updates belong in a separate deployment surface. */
  showImageSection?: boolean;
}

export interface ContainerPublicAddressesSettingsPaneProps {
  className?: string;
  identityKey?: string;
  network: ContainerNetwork;
  networkPlatformAddressDraftContext?: ContainerNetworkPlatformAddressDraftContext;
  onCustomDomainCnameVerify?: ContainerCustomDomainCnameVerifier;
  onNetworkDraftCommit?: (
    network: ContainerNetwork,
    meta: ContainerPublicAddressesSettingsDraftCommitMeta
  ) => void | Promise<void>;
  onSettingsDraftLeaveGuardChange?: SettingsLeaveGuardRegistration;
  readOnly?: boolean;
}

interface AddDbDsnReferenceIntentDraftMetadata {
  canvasAddDbDsnReferenceIntentId?: string;
}

type EnvDraftRow = ContainerEnvVar & AddDbDsnReferenceIntentDraftMetadata;

function publicAddressDraftsEqual(
  a: readonly ContainerNetworkPublicAddress[],
  b: readonly ContainerNetworkPublicAddress[]
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((address, index) => {
    const other = b[index];
    return (
      other != null &&
      (address.id?.trim() ?? "") === (other.id?.trim() ?? "") &&
      Math.round(address.port) === Math.round(other.port)
    );
  });
}

function customDomainDraftsEqual(
  a: readonly ContainerNetworkCustomDomain[] | undefined,
  b: readonly ContainerNetworkCustomDomain[] | undefined
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
      domain.id.trim() === other.id.trim() &&
      domain.domain.trim().toLowerCase() ===
        other.domain.trim().toLowerCase() &&
      domain.platformAddressId.trim() === other.platformAddressId.trim()
    );
  });
}

function containerNetworksEqual(
  a: ContainerNetwork | undefined,
  b: ContainerNetwork | undefined
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return (
    Math.round(a.privatePort) === Math.round(b.privatePort) &&
    appListeningPortDraftsEqual(
      appListeningPortsFromNetwork(a),
      appListeningPortsFromNetwork(b)
    ) &&
    publicAddressDraftsEqual(a.publicAddresses, b.publicAddresses) &&
    customDomainDraftsEqual(a.customDomains, b.customDomains)
  );
}

function containerDraftResourcesDirty(
  original: ContainerSettingsDraft,
  draft: ContainerSettingsDraft
): boolean {
  const cpuMemDirty =
    Math.abs(draft.cpuCores - original.cpuCores) > CPU_QUOTA_DIRTY_EPS ||
    Math.round(draft.memoryMib) !== Math.round(original.memoryMib);
  if (cpuMemDirty) {
    return true;
  }
  if (original.replicaStrategy == null || draft.replicaStrategy == null) {
    return original.replicaStrategy !== draft.replicaStrategy;
  }
  return !replicaStrategiesEqual(
    draft.replicaStrategy,
    original.replicaStrategy
  );
}

export function containerSettingsDraftIsDirty(
  original: ContainerSettingsDraft,
  draft: ContainerSettingsDraft
): boolean {
  return (
    draft.image.trim() !== original.image.trim() ||
    !containerEnvRowsEqual([...draft.env], [...original.env]) ||
    containerDraftResourcesDirty(original, draft) ||
    !containerNetworksEqual(original.network, draft.network)
  );
}

function containerSettingsDraftBackingKey(draft: ContainerSettingsDraft) {
  return JSON.stringify(draft);
}

function containerNetworkDraftBackingKey(network: ContainerNetwork) {
  return JSON.stringify(network);
}

interface ContainerSettingsDraftValues {
  cpuCores: number;
  env: readonly ContainerEnvVar[];
  image: string;
  memoryMib: number;
  network?: ContainerNetwork;
  replicaStrategy?: ContainerReplicaStrategy;
}

function containerSettingsDraftFromValues({
  cpuCores,
  env,
  image,
  memoryMib,
  network,
  replicaStrategy,
}: ContainerSettingsDraftValues): ContainerSettingsDraft {
  return {
    cpuCores,
    env,
    image,
    memoryMib,
    ...(network == null ? {} : { network }),
    ...(replicaStrategy == null
      ? {}
      : {
          replicaStrategy,
          replicas: replicaStrategy.fixed.replicas,
        }),
  };
}

function formatPlainNumber(value: number, maximumFractionDigits: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value);
}

function cpuCoresValueSuffix(cores: number) {
  const rounded = Number(cores.toFixed(2));
  return rounded === 1 ? " Core" : " Cores";
}

function formatMemoryMibValue(mib: number) {
  const rounded = Math.round(mib);
  if (Math.abs(rounded) >= 1024) {
    return `${formatPlainNumber(rounded / 1024, 2)} Gi`;
  }
  return `${formatPlainNumber(rounded, 0)} Mi`;
}

function memoryMibDisplayValue(mib: number) {
  const rounded = Math.round(mib);
  if (Math.abs(rounded) >= 1024) {
    return rounded / 1024;
  }
  return rounded;
}

function memoryMibValueSuffix(mib: number) {
  return Math.abs(Math.round(mib)) >= 1024 ? " Gi" : " Mi";
}

function formatReplicaValue(replicas: number) {
  const rounded = Math.round(replicas);
  return formatPlainNumber(rounded, 0);
}

const DB_REFERENCE_FIELD_LABELS: Record<ContainerEnvDbReferenceField, string> =
  {
    host: "Host",
    password: "Password",
    port: "Port",
    private: "Private DSN",
    public: "Public DSN",
    username: "Username",
  };

function validContainerNetworkPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

function appListeningPortsFromNetwork(
  network: Pick<
    ContainerNetwork,
    "appListeningPorts" | "privateAddress" | "privatePort"
  >
): ContainerNetworkAppListeningPort[] {
  const rows = network.appListeningPorts ?? [];
  const normalized = rows.flatMap((row) =>
    validContainerNetworkPort(Math.round(row.port))
      ? [
          {
            ...(row.privateAddress == null || row.privateAddress.trim() === ""
              ? {}
              : { privateAddress: row.privateAddress }),
            port: Math.round(row.port),
          },
        ]
      : []
  );
  if (normalized.length > 0) {
    return normalized;
  }
  return [
    {
      ...(network.privateAddress == null || network.privateAddress.trim() === ""
        ? {}
        : { privateAddress: network.privateAddress }),
      port: Math.round(network.privatePort),
    },
  ];
}

function networkWithAppListeningPorts(
  network: ContainerNetwork,
  appListeningPorts: readonly ContainerNetworkAppListeningPort[]
): ContainerNetwork {
  const normalized =
    appListeningPorts.length === 0
      ? appListeningPortsFromNetwork(network).slice(0, 1)
      : appListeningPorts.map((row) => ({
          ...(row.privateAddress == null || row.privateAddress.trim() === ""
            ? {}
            : { privateAddress: row.privateAddress }),
          port: Math.round(row.port),
        }));
  const first = normalized[0];
  return {
    ...network,
    ...(first?.privateAddress == null
      ? {}
      : { privateAddress: first.privateAddress }),
    appListeningPorts: [...normalized],
    privatePort: first?.port ?? network.privatePort,
  };
}

function networkWithAppListeningPort(
  network: ContainerNetwork,
  port: number
): ContainerNetwork {
  const rounded = Math.round(port);
  const ports = appListeningPortsFromNetwork(network);
  if (ports.some((row) => Math.round(row.port) === rounded)) {
    return networkWithAppListeningPorts(network, ports);
  }
  return networkWithAppListeningPorts(network, [...ports, { port: rounded }]);
}

function networkWithoutAppListeningPort(
  network: ContainerNetwork,
  port: number
): ContainerNetwork {
  const rounded = Math.round(port);
  const next = appListeningPortsFromNetwork(network).filter(
    (row) => Math.round(row.port) !== rounded
  );
  return networkWithAppListeningPorts(network, next);
}

function addedAppListeningPorts(
  previous: ContainerNetwork,
  next: ContainerNetwork
): number[] {
  const previousPorts = new Set(
    appListeningPortsFromNetwork(previous).map((row) => Math.round(row.port))
  );
  return appListeningPortsFromNetwork(next)
    .map((row) => Math.round(row.port))
    .filter((port) => !previousPorts.has(port));
}

function appListeningPortDraftsEqual(
  a: readonly ContainerNetworkAppListeningPort[] | undefined,
  b: readonly ContainerNetworkAppListeningPort[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) {
    return false;
  }
  return left.every((row, index) => {
    const other = right[index];
    return other != null && Math.round(row.port) === Math.round(other.port);
  });
}

function publicAddressDefaultPort(network: ContainerNetwork): number {
  return appListeningPortsFromNetwork(network)[0]?.port ?? 80;
}

function publicAddressesTargetingPort(
  network: ContainerNetwork,
  port: number
): ContainerNetworkPublicAddress[] {
  const rounded = Math.round(port);
  return network.publicAddresses.filter(
    (address) => Math.round(address.port) === rounded
  );
}

function publicAddressDisplayName(address: ContainerNetworkPublicAddress) {
  return (
    publicAddressValue(address) ||
    address.host?.trim() ||
    address.id?.trim() ||
    `Port ${address.port}`
  );
}

function envDbDsnFieldLabel(field: ContainerEnvDbReferenceField): string {
  return DB_REFERENCE_FIELD_LABELS[field];
}

function envRowDisplayValue(row: ContainerEnvVar): string {
  if (row.valueSource === "dbDsn" && row.dbDsn != null) {
    return `${row.dbDsn.dbName} ${envDbDsnFieldLabel(row.dbDsn.field)}`;
  }
  return row.valueSource === "valueFrom" ? "External reference" : row.value;
}

function envRowKey(row: ContainerEnvVar, index: number): string {
  return [
    index,
    row.name,
    row.value,
    row.valueSource ?? "direct",
    row.valueFrom == null ? "" : JSON.stringify(row.valueFrom),
  ].join("\u0000");
}

function nextEnvDraftKey(prefix: string, counter: { current: number }): string {
  const key = `${prefix}-${counter.current}`;
  counter.current += 1;
  return key;
}

function createEnvDraftKeys(
  count: number,
  prefix: string,
  counter: { current: number }
): string[] {
  return Array.from({ length: count }, () => nextEnvDraftKey(prefix, counter));
}

function resizeEnvDraftKeys(
  keys: readonly string[],
  count: number,
  prefix: string,
  counter: { current: number }
): string[] {
  if (keys.length === count) {
    return [...keys];
  }
  if (keys.length > count) {
    return keys.slice(0, count);
  }
  return [...keys, ...createEnvDraftKeys(count - keys.length, prefix, counter)];
}

function ExternalEnvBadge({ className }: { className?: string }) {
  return (
    <Badge className={className} variant="outline">
      External
    </Badge>
  );
}

function ReferenceEnvBadge({ className }: { className?: string }) {
  return (
    <Badge className={className} variant="outline">
      Reference
    </Badge>
  );
}

function dbDsnSourceKey(source: ContainerEnvDbDsnSource): string {
  return containerEnvDbSourceKey(source);
}

function dbDsnSourceMatchesTarget(
  source: ContainerEnvDbDsnSource,
  target: ContainerEnvDbDsnReferenceTarget
): boolean {
  return source.name === target.name && source.namespace === target.namespace;
}

function addDbDsnReferenceIntentTarget(
  intent: ContainerSettingsPaneAddDbDsnReferenceIntent
): ContainerEnvDbDsnReferenceTarget {
  return { name: intent.dbName, namespace: intent.dbNamespace };
}

function dbDsnSourceFromAddReferenceIntent(
  sources: readonly ContainerEnvDbDsnSource[],
  intent: ContainerSettingsPaneAddDbDsnReferenceIntent | null | undefined
): ContainerEnvDbDsnSource | undefined {
  if (intent == null) {
    return undefined;
  }
  const target = addDbDsnReferenceIntentTarget(intent);
  return sources.find((source) => dbDsnSourceMatchesTarget(source, target));
}

function appendDbDsnReferenceIntentRow(
  rows: readonly ContainerEnvVar[],
  source: ContainerEnvDbDsnSource,
  intent: ContainerSettingsPaneAddDbDsnReferenceIntent
): EnvDraftRow[] {
  const field = containerEnvDbDsnFieldOptions(source)[0];
  return [
    ...rows,
    {
      ...(field == null
        ? { value: "" }
        : containerEnvDbReferenceRowPatch(source, field)),
      canvasAddDbDsnReferenceIntentId: intent.id,
      name: defaultContainerEnvDbReferenceRowName(rows, field?.field),
      referenceDbKey: dbDsnSourceKey(source),
    },
  ];
}

function envDraftWithAddReferenceIntent({
  intent,
  readOnly,
  rows,
  sources,
}: {
  intent: ContainerSettingsPaneAddDbDsnReferenceIntent | null | undefined;
  readOnly: boolean;
  rows: readonly ContainerEnvVar[];
  sources: readonly ContainerEnvDbDsnSource[];
}): {
  consumedIntentId?: string;
  rows: EnvDraftRow[];
} {
  if (intent == null) {
    return { rows: [...rows] };
  }
  if (readOnly) {
    return { rows: [...rows] };
  }
  const source = dbDsnSourceFromAddReferenceIntent(sources, intent);
  if (source === undefined) {
    return { consumedIntentId: intent.id, rows: [...rows] };
  }
  return {
    consumedIntentId: intent.id,
    rows: appendDbDsnReferenceIntentRow(rows, source, intent),
  };
}

export function confirmedAddDbDsnReferencesFromEnvDraft(
  rows: readonly ContainerEnvVar[]
): ContainerSettingsPaneConfirmedAddDbDsnReference[] {
  const byIntentId = new Map<
    string,
    ContainerSettingsPaneConfirmedAddDbDsnReference
  >();

  for (const row of rows) {
    const intentId = (row as EnvDraftRow).canvasAddDbDsnReferenceIntentId;
    if (intentId == null || intentId === "") {
      continue;
    }
    if (row.dbDsn != null) {
      byIntentId.set(intentId, {
        dbName: row.dbDsn.dbName,
        dbNamespace: row.dbDsn.dbNamespace,
        id: intentId,
      });
      continue;
    }
    const sourceKey = row.referenceDbKey;
    const hasMaterializedHelper = rows.some(
      (candidate) => candidate.helper?.sourceDbKey === sourceKey
    );
    if (sourceKey == null || !hasMaterializedHelper) {
      continue;
    }
    const slashIndex = sourceKey.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= sourceKey.length - 1) {
      continue;
    }
    byIntentId.set(intentId, {
      dbName: sourceKey.slice(slashIndex + 1),
      dbNamespace: sourceKey.slice(0, slashIndex),
      id: intentId,
    });
  }

  return Array.from(byIntentId.values());
}

function ReadOnlyEnvRows({ env }: { env: readonly ContainerEnvVar[] }) {
  return (
    <div
      className="flex max-h-72 w-full flex-col gap-2 overflow-y-auto"
      data-slot="container-env-rows"
    >
      {env.length === 0 ? (
        <span className="flex h-9 items-center rounded-md border border-input bg-transparent px-3 text-muted-foreground text-sm leading-5">
          No variables
        </span>
      ) : (
        env.map((row, index) => (
          <div
            className="grid min-w-0 gap-2 sm:grid-cols-2"
            key={envRowKey(row, index)}
          >
            <span
              className="flex h-9 min-w-0 items-center truncate rounded-md border border-input bg-transparent px-3 text-foreground text-sm leading-5"
              title={row.name}
            >
              {row.name}
            </span>
            <span
              className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-foreground text-sm leading-5"
              title={envRowDisplayValue(row)}
            >
              <span className="min-w-0 truncate">
                {envRowDisplayValue(row)}
              </span>
              {row.valueSource === "valueFrom" ? (
                <ExternalEnvBadge className="shrink-0" />
              ) : null}
              {row.valueSource === "dbDsn" ? (
                <ReferenceEnvBadge className="shrink-0" />
              ) : null}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

interface EditableEnvRowsProps {
  dbDsnReferenceSources: ContainerEnvDbDsnSource[];
  envDirty: boolean;
  envDraft: ContainerEnvVar[];
  envErrorsByIndex: ReadonlyMap<number, string>;
  envRowKeys: readonly string[];
  envTokenDiagnostics: readonly EnvTokenDiagnostic[];
  envValidation: ReturnType<typeof validateContainerEnvRows>;
  onDeleteRow: (index: number) => void;
  onUpdateRow: (index: number, patch: Partial<ContainerEnvRow>) => void;
  rows: ContainerEnvVar[];
}

interface EditableEnvNameControlProps {
  dbDsnReferenceSources: ContainerEnvDbDsnSource[];
  error?: string;
  index: number;
  managed?: boolean;
  onUpdateRow: (index: number, patch: Partial<ContainerEnvRow>) => void;
  row: ContainerEnvVar;
}

interface EditableEnvValueControlProps {
  dbDsnReferenceSources: ContainerEnvDbDsnSource[];
  index: number;
  managed?: boolean;
  onUpdateRow: (index: number, patch: Partial<ContainerEnvRow>) => void;
  row: ContainerEnvVar;
  rows: ContainerEnvVar[];
}

function envRowIsManagedHelper(row: ContainerEnvVar): boolean {
  return row.helper?.automatic === true;
}

function envRowUsesExternalValue(row: ContainerEnvVar): boolean {
  return row.valueFrom != null || row.valueSource === "valueFrom";
}

function EditableEnvNameControl({
  dbDsnReferenceSources,
  error,
  index,
  managed = false,
  onUpdateRow,
  row,
}: EditableEnvNameControlProps) {
  if (managed) {
    return (
      <div className="flex h-9 min-w-0 items-center rounded-md border border-input bg-white/5 px-3 text-foreground text-sm leading-5">
        <span className="min-w-0 truncate">{row.name}</span>
      </div>
    );
  }

  const referenceSources = dbDsnReferenceSources;
  const canAddReference = referenceSources.length > 0;
  const input = (
    <AppInput
      aria-invalid={error != null}
      aria-label="Environment variable name"
      className={
        canAddReference
          ? "border-0 shadow-none focus-visible:border-transparent focus-visible:ring-0"
          : undefined
      }
      onChange={(event) =>
        onUpdateRow(index, {
          name: event.target.value,
        })
      }
      placeholder="Name"
      value={row.name}
      variant={canAddReference ? "bare" : undefined}
    />
  );

  if (!canAddReference) {
    return input;
  }

  return (
    <div className="flex h-9 min-w-0 items-center rounded-md border border-input bg-transparent focus-within:border-blue-400 focus-within:ring-[1px] focus-within:ring-blue-400/50">
      <div className="min-w-0 flex-1">{input}</div>
      <Select
        onValueChange={(value) => {
          onUpdateRow(index, { referenceDbKey: value });
        }}
        value={row.referenceDbKey}
      >
        <SelectTrigger
          aria-label="Reference"
          className="mr-1 h-7 w-auto shrink-0 gap-1.5 rounded-md bg-white/5 px-2.5 py-1 text-muted-foreground text-sm hover:bg-input/40 hover:text-foreground focus:ring-0 focus:ring-offset-0"
          data-slot="container-env-reference-trigger"
          indicator={false}
          variant="ghost"
        >
          <SelectValue placeholder="Reference" />
          <ChevronDown aria-hidden className="size-4" />
        </SelectTrigger>
        <SelectContent className="border-border bg-input/30 shadow-none backdrop-blur-xl">
          {referenceSources.map((source) => (
            <SelectItem
              className="pl-2 focus:bg-input/30 data-[highlighted]:bg-input/30 data-[state=checked]:bg-input"
              indicator={false}
              key={dbDsnSourceKey(source)}
              value={dbDsnSourceKey(source)}
            >
              {source.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EditableEnvValueControl({
  dbDsnReferenceSources,
  index,
  managed = false,
  onUpdateRow,
  row,
  rows,
}: EditableEnvValueControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const externalValue = envRowUsesExternalValue(row);
  if (managed) {
    return (
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-white/5 px-3 text-foreground text-sm leading-5">
        <span className="min-w-0 truncate">
          {externalValue ? "External reference" : row.value}
        </span>
        {externalValue ? <ExternalEnvBadge className="shrink-0" /> : null}
      </div>
    );
  }

  if (externalValue) {
    return (
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-foreground text-sm leading-5">
        <span className="min-w-0 truncate">External reference</span>
        <ExternalEnvBadge className="shrink-0" />
      </div>
    );
  }

  const menuItems = buildContainerEnvTokenMenuItems({
    dbSources: dbDsnReferenceSources,
    row,
    rows,
  });

  return (
    <div className="flex h-9 min-w-0 items-center rounded-md border border-input bg-transparent focus-within:border-blue-400 focus-within:ring-[1px] focus-within:ring-blue-400/50">
      <AppInput
        aria-label="Environment variable value"
        className="border-0 shadow-none focus-visible:border-transparent focus-visible:ring-0"
        onChange={(event) =>
          onUpdateRow(index, {
            value: event.target.value,
            valueSource: "direct",
          })
        }
        placeholder="Value"
        ref={inputRef}
        value={row.value}
        variant="bare"
      />
      <Select
        disabled={menuItems.length === 0}
        onValueChange={(token) => {
          const nextValue = insertContainerEnvTokenText(
            row.value,
            token,
            inputRef.current?.selectionStart,
            inputRef.current?.selectionEnd
          );
          onUpdateRow(index, {
            value: nextValue,
            valueSource: "direct",
          });
        }}
      >
        <SelectTrigger
          aria-label="Insert environment reference token"
          className="mr-1 size-7 shrink-0 justify-center rounded-md bg-white/5 p-0 text-muted-foreground hover:bg-input/40 hover:text-foreground focus:ring-0 focus:ring-offset-0"
          data-slot="container-env-token-trigger"
          indicator={false}
          title="Insert reference token"
          variant="ghost"
        >
          <Braces aria-hidden className="size-4" />
        </SelectTrigger>
        <SelectContent className="border-border bg-input/30 shadow-none backdrop-blur-xl">
          {menuItems.map((item) => (
            <SelectItem
              className="pl-2 focus:bg-input/30 data-[highlighted]:bg-input/30 data-[state=checked]:bg-input"
              indicator={false}
              key={`${item.source ?? "env"}-${item.token}`}
              value={item.token}
            >
              <span className="grid min-w-0">
                <span className="min-w-0 truncate">{item.label}</span>
                {item.description == null ? null : (
                  <span className="min-w-0 truncate text-muted-foreground text-xs">
                    {item.description}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function EditableEnvRows({
  dbDsnReferenceSources,
  envDirty,
  envDraft,
  envErrorsByIndex,
  envRowKeys,
  envTokenDiagnostics = [],
  envValidation,
  onDeleteRow,
  onUpdateRow,
  rows,
}: EditableEnvRowsProps) {
  return (
    <div
      className="flex max-h-72 w-full flex-col gap-2 overflow-y-auto"
      data-slot="container-env-rows"
    >
      {envDraft.length === 0 ? (
        <div className="flex h-9 items-center rounded-md border border-input bg-transparent px-3 text-muted-foreground text-sm leading-5">
          No variables
        </div>
      ) : (
        envDraft.map((row, index) => {
          const error = envErrorsByIndex.get(index);
          const managed = envRowIsManagedHelper(row);
          const rowKey = envRowKeys[index] ?? envRowKey(row, index);
          return (
            <div className="grid min-w-0 gap-1.5" key={rowKey}>
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem]">
                <EditableEnvNameControl
                  dbDsnReferenceSources={dbDsnReferenceSources}
                  error={error}
                  index={index}
                  managed={managed}
                  onUpdateRow={onUpdateRow}
                  row={row}
                />
                <EditableEnvValueControl
                  dbDsnReferenceSources={dbDsnReferenceSources}
                  index={index}
                  managed={managed}
                  onUpdateRow={onUpdateRow}
                  row={row}
                  rows={rows}
                />
                {managed ? (
                  <div aria-hidden className="size-9" />
                ) : (
                  <AppIconButton
                    aria-label="Remove environment variable"
                    className="hover:text-red-500"
                    onClick={() => onDeleteRow(index)}
                    size="lg"
                    type="button"
                    variant="quiet"
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </AppIconButton>
                )}
              </div>
              {error == null ? null : (
                <p className="text-destructive text-xs" role="status">
                  {error}
                </p>
              )}
            </div>
          );
        })
      )}
      {!envValidation.valid && envDirty ? (
        <p className="text-destructive text-xs" role="status">
          Fix environment variable names before saving.
        </p>
      ) : null}
      {envTokenDiagnostics.length === 0 ? null : (
        <p className="text-destructive text-xs" role="status">
          {envTokenDiagnostics[0]?.message}
        </p>
      )}
    </div>
  );
}

interface NetworkSettingsSectionProps {
  network: ContainerNetwork;
  onCustomDomainCnameVerify?: ContainerCustomDomainCnameVerifier;
  onNetworkChange?: (network: ContainerNetwork) => void | Promise<void>;
  onNetworkDraftChange?: (network: ContainerNetwork) => void;
  platformAddressDraftContext?: ContainerNetworkPlatformAddressDraftContext;
  readOnly: boolean;
}

const PUBLIC_ADDRESS_VISIBLE_COUNT = 3;

function canMutateNetworkDraft({
  onNetworkChange,
  onNetworkDraftChange,
  readOnly,
}: Pick<
  NetworkSettingsSectionProps,
  "onNetworkChange" | "onNetworkDraftChange" | "readOnly"
>): boolean {
  return !readOnly && (onNetworkDraftChange != null || onNetworkChange != null);
}

function publicAddressValue(address: ContainerNetworkPublicAddress): string {
  return address.url?.trim() || address.host?.trim() || "";
}

function publicAddressHostValue(
  address: ContainerNetworkPublicAddress | undefined
): string {
  const host = address?.host?.trim() ?? "";
  if (host !== "") {
    return host;
  }
  const url = address?.url?.trim() ?? "";
  if (url === "") {
    return "";
  }
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function publicAddressStatusLabel(
  address: ContainerNetworkPublicAddress
): string {
  const status = address.status?.trim() || "Pending";
  const reason = address.reason?.trim();
  return reason == null || reason === "" ? status : `${status}: ${reason}`;
}

function publicAddressStatusDotClasses(
  address: ContainerNetworkPublicAddress
): { inner: string; outer: string } {
  const status = address.status?.trim().toLowerCase();

  if (
    status === "accessible" ||
    status === "available" ||
    status === "ready" ||
    status === "running"
  ) {
    return { inner: "bg-green-500", outer: "bg-green-500/30" };
  }

  if (
    status === "progressing" ||
    status === "pending" ||
    status === "verifying" ||
    status === "creating"
  ) {
    return { inner: "bg-amber-500", outer: "bg-amber-500/30" };
  }

  if (
    status === "blocked" ||
    status === "failed" ||
    status === "error" ||
    status === "inaccessible" ||
    status === "unavailable"
  ) {
    return { inner: "bg-red-500", outer: "bg-red-500/30" };
  }

  return { inner: "bg-zinc-400", outer: "bg-zinc-400/30" };
}

function customDomainStatusLabel(domain: ContainerNetworkCustomDomain): string {
  const status = domain.status?.trim() || "Pending";
  const reason = domain.reason?.trim();
  return reason == null || reason === "" ? status : `${status}: ${reason}`;
}

interface PublicAddressStatusDotProps {
  address: Pick<ContainerNetworkPublicAddress, "status">;
  ariaLabel: string;
  className?: string;
  tooltip?: ReactNode;
}

function PublicAddressStatusDot({
  address,
  ariaLabel,
  className,
  tooltip,
}: PublicAddressStatusDotProps) {
  const classes = publicAddressStatusDotClasses({
    port: 1,
    status: address.status,
  });
  const dot = (
    <span
      className={cn(
        "flex size-3.5 shrink-0 items-center justify-center rounded-full",
        classes.outer
      )}
    >
      <span className={cn("size-2 rounded-full", classes.inner)} />
    </span>
  );

  if (tooltip == null) {
    return (
      <span
        aria-label={ariaLabel}
        className={className}
        role="img"
        title={ariaLabel}
      >
        {dot}
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          className
        )}
        type="button"
      >
        {dot}
      </TooltipTrigger>
      <TooltipContent align="start" className="max-w-72 text-left">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function publicAddressKey(
  address: ContainerNetworkPublicAddress,
  index: number
): string {
  return (
    address.id?.trim() ||
    address.host?.trim().toLowerCase() ||
    `pending-${index}`
  );
}

function customDomainKey(
  domain: ContainerNetworkCustomDomain,
  index: number
): string {
  return (
    domain.id.trim() || domain.domain.trim().toLowerCase() || `cd-${index}`
  );
}

function platformAddressDraftFromPort(
  port: number,
  platformAddressDraftContext?: ContainerNetworkPlatformAddressDraftContext
): PublicAddressDraft {
  const id = generatePlatformAddressId();
  const domainPrefix = generatePlatformAddressDomainPrefix();
  const endpoint = platformAddressEndpoint({
    appName: platformAddressDraftContext?.appName ?? "",
    domainPrefix,
    namespace: platformAddressDraftContext?.namespace ?? "",
    platformAddressId: id,
    routingDomain: platformAddressDraftContext?.routingDomain ?? "",
  });
  return {
    ...(endpoint ?? {}),
    domainPrefix,
    id,
    port,
    status: "progressing",
    type: "platform",
  };
}

function isPublicAddressDeleteTarget(
  address: ContainerNetworkPublicAddress,
  index: number,
  target: ContainerNetworkPublicAddress | undefined,
  targetIndex: number
): boolean {
  const targetId = target?.id?.trim();
  if (targetId == null || targetId === "") {
    return index === targetIndex;
  }
  return address.id?.trim() === targetId;
}

interface PublicAddressRowProps {
  address: ContainerNetworkPublicAddress;
  onBindCustomDomain?: () => void;
  onDelete?: () => void | Promise<void>;
  readOnly: boolean;
  rowKey: string;
}

function PublicAddressRow({
  address,
  onBindCustomDomain,
  onDelete,
  readOnly,
  rowKey,
}: PublicAddressRowProps) {
  const [pending, setPending] = useState(false);
  const value = publicAddressValue(address);
  const copyable = value !== "";

  const handleDelete = async () => {
    if (onDelete == null) {
      return;
    }
    setPending(true);
    try {
      await onDelete();
    } finally {
      setPending(false);
    }
  };

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "relative flex min-h-17 min-w-0 items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-2 transition-colors",
        copyable && "hover:bg-input"
      )}
      copyAriaLabel="Copy Public Address"
      copyable={copyable}
      copyValue={value}
      rowKey={rowKey}
      title={copyable ? value : undefined}
    >
      {({ copyable: rowCopyable }) => (
        <>
          <div
            aria-hidden={rowCopyable ? true : undefined}
            className={cn(
              "relative z-10 grid min-w-0 flex-1 gap-2",
              rowCopyable ? "pointer-events-none" : "pointer-events-auto"
            )}
          >
            <div className="flex min-w-0 items-center gap-1.5 text-foreground text-sm leading-5">
              <PublicAddressStatusDot
                address={address}
                ariaLabel={`Public Address status: ${publicAddressStatusLabel(address)}`}
              />
              <span className="min-w-0 truncate">
                {value === "" ? "Pending domain" : value}
              </span>
              <CanvasNode.CopyableRowIndicator className="text-muted-foreground" />
            </div>
            <div className="min-w-0 truncate text-muted-foreground text-sm leading-5">
              {address.port}
            </div>
          </div>
          <CanvasNode.CopyableRowControl className="relative z-20 flex shrink-0 items-center gap-2">
            {readOnly || onBindCustomDomain == null ? null : (
              <AppIconButton
                aria-label="Edit Public Address"
                disabled={value === ""}
                onClick={onBindCustomDomain}
                size="lg"
                type="button"
                variant="secondary"
              >
                <Settings aria-hidden />
              </AppIconButton>
            )}
            {readOnly || onDelete == null ? null : (
              <AppIconButton
                aria-label="Delete Public Address"
                disabled={pending}
                onClick={handleDelete}
                size="lg"
                type="button"
                variant="danger"
              >
                <Trash2 aria-hidden />
              </AppIconButton>
            )}
          </CanvasNode.CopyableRowControl>
        </>
      )}
    </CanvasNode.CopyableRow>
  );
}

interface CustomDomainRowProps {
  domain: ContainerNetworkCustomDomain;
  onUnbind?: () => void | Promise<void>;
  readOnly: boolean;
}

function lifecycleDetailLabel(
  label: string,
  detail: ContainerNetworkCustomDomainDetail | undefined
): string {
  const status = detail?.status?.trim().toLowerCase() || "unknown";
  return `${label} ${status}`;
}

function lifecycleDetailText(
  detail: ContainerNetworkCustomDomainDetail | undefined
): string {
  const reason = detail?.reason?.trim() ?? "";
  const message = detail?.message?.trim() ?? "";
  if (reason !== "" && message !== "") {
    return `${reason}: ${message}`;
  }
  return reason || message;
}

function customDomainLifecycleDetails(
  domain: ContainerNetworkCustomDomain
): string[] {
  return [
    ["DNS", domain.dns] as const,
    ["Certificate", domain.certificate] as const,
    ["Routing", domain.routing] as const,
  ].map(([label, detail]) => {
    const summary = lifecycleDetailLabel(label, detail);
    const text = lifecycleDetailText(detail);
    return text === "" ? summary : `${summary}: ${text}`;
  });
}

function customDomainStatusAriaLabel(
  domain: ContainerNetworkCustomDomain
): string {
  return [
    `Custom Domain status: ${customDomainStatusLabel(domain)}`,
    ...customDomainLifecycleDetails(domain),
  ].join("; ");
}

function CustomDomainStatusTooltip({
  domain,
}: {
  domain: ContainerNetworkCustomDomain;
}) {
  const details = customDomainLifecycleDetails(domain);

  return (
    <div className="grid gap-1">
      <div className="font-medium">
        Custom Domain status: {customDomainStatusLabel(domain)}
      </div>
      {details.map((detail) => (
        <div className="text-background/80" key={detail}>
          {detail}
        </div>
      ))}
    </div>
  );
}

function CustomDomainRow({ domain, onUnbind, readOnly }: CustomDomainRowProps) {
  const [pending, setPending] = useState(false);
  const handleUnbind = async () => {
    if (onUnbind == null) {
      return;
    }
    setPending(true);
    try {
      await onUnbind();
    } finally {
      setPending(false);
    }
  };
  const targetPort = domain.targetPort ?? undefined;
  const targetText =
    domain.cnameTarget == null || domain.cnameTarget.trim() === ""
      ? domain.platformAddressId
      : domain.cnameTarget.trim();
  const detailText = targetPort == null ? targetText : String(targetPort);
  const statusAriaLabel = customDomainStatusAriaLabel(domain);

  return (
    <div className="flex min-h-17 min-w-0 items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-2">
      <div className="grid min-w-0 flex-1 gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-foreground text-sm leading-5">
          <PublicAddressStatusDot
            address={{ status: domain.status }}
            ariaLabel={statusAriaLabel}
            tooltip={<CustomDomainStatusTooltip domain={domain} />}
          />
          <span className="min-w-0 truncate">{domain.domain}</span>
        </div>
        <div className="min-w-0 truncate text-muted-foreground text-sm leading-5">
          {detailText}
        </div>
      </div>
      {readOnly || onUnbind == null ? null : (
        <AppIconButton
          aria-label="Unbind Custom Domain"
          disabled={pending}
          onClick={handleUnbind}
          size="lg"
          title="Unbind Custom Domain"
          type="button"
          variant="danger"
        >
          <Trash2 aria-hidden />
        </AppIconButton>
      )}
    </div>
  );
}

function normalizeCustomDomainDraft(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/g, "");
}

interface VisibleDomainRows {
  customDomains: ContainerNetworkCustomDomain[];
  publicAddresses: ContainerNetworkPublicAddress[];
}

function visibleDomainRows(network: ContainerNetwork): VisibleDomainRows {
  const customDomains = network.customDomains ?? [];
  const boundPlatformAddressIds = new Set(
    customDomains.map((domain) => domain.platformAddressId.trim())
  );
  return {
    customDomains,
    publicAddresses: network.publicAddresses.filter(
      (address) => !boundPlatformAddressIds.has(address.id?.trim() ?? "")
    ),
  };
}

export function containerNetworkAfterUnbindCustomDomain(
  network: ContainerNetwork,
  target: Pick<ContainerNetworkCustomDomain, "id">
): ContainerNetwork {
  const targetId = target.id.trim();
  return {
    ...network,
    customDomains: (network.customDomains ?? []).filter(
      (domain) => domain.id.trim() !== targetId
    ),
  };
}

function publicAddressIdValue(address: ContainerNetworkPublicAddress): string {
  return address.id?.trim() || address.platformAddressId?.trim() || "";
}

function isPublicAddressMutationTarget(
  address: ContainerNetworkPublicAddress,
  index: number,
  target: ContainerNetworkPublicAddress,
  targetIndex: number
): boolean {
  const targetId = publicAddressIdValue(target);
  if (targetId !== "") {
    return publicAddressIdValue(address) === targetId;
  }
  return address === target || index === targetIndex;
}

export function containerNetworkAfterBindCustomDomain(
  network: ContainerNetwork,
  draft: {
    customDomain: ContainerNetworkCustomDomain;
    platformAddress: ContainerNetworkPublicAddress;
    platformAddressIndex: number;
    port: number;
  }
): ContainerNetwork {
  return containerNetworkAfterEditPublicAddress(network, draft);
}

export function containerNetworkAfterEditPublicAddress(
  network: ContainerNetwork,
  draft: {
    customDomain?: ContainerNetworkCustomDomain;
    platformAddress: ContainerNetworkPublicAddress;
    platformAddressIndex: number;
    port: number;
  }
): ContainerNetwork {
  const next = {
    ...network,
    customDomains:
      draft.customDomain == null
        ? network.customDomains
        : [
            ...(network.customDomains ?? []),
            { ...draft.customDomain, targetPort: draft.port },
          ],
    publicAddresses: network.publicAddresses.map((address, index) =>
      isPublicAddressMutationTarget(
        address,
        index,
        draft.platformAddress,
        draft.platformAddressIndex
      )
        ? { ...address, port: draft.port }
        : address
    ),
  };
  return networkWithAppListeningPort(next, draft.port);
}

async function commitNetworkChange(
  network: ContainerNetwork,
  options: Pick<
    NetworkSettingsSectionProps,
    "onNetworkChange" | "onNetworkDraftChange"
  >
) {
  if (options.onNetworkDraftChange != null) {
    options.onNetworkDraftChange(network);
    return;
  }
  if (options.onNetworkChange != null) {
    await options.onNetworkChange(network);
  }
}

interface NetworkCardProps {
  actions?: ReactNode;
  children: ReactNode;
  title: string;
}

function NetworkCard({ actions, children, title }: NetworkCardProps) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border border-border">
      <div className="flex h-11 min-w-0 items-center gap-1.5 border-border border-b px-2.5">
        <Network
          aria-hidden
          className="size-4 shrink-0 text-foreground"
          strokeWidth={2}
        />
        <Label className="min-w-0 truncate font-medium text-foreground text-sm">
          {title}
        </Label>
        {actions == null ? null : (
          <div className="ml-auto flex shrink-0 items-center">{actions}</div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2 px-2.5 pb-3">{children}</div>
    </section>
  );
}

interface PrivateAddressRowProps {
  address: string;
  affectedPublicAddressCount: number;
  canDelete: boolean;
  onDelete?: () => void;
  port: number;
  readOnly: boolean;
  rowKey: string;
}

function PrivateAddressRow({
  affectedPublicAddressCount,
  address,
  canDelete,
  onDelete,
  port,
  readOnly,
  rowKey,
}: PrivateAddressRowProps) {
  const copyable = address.trim() !== "";
  const countLabel =
    affectedPublicAddressCount === 1
      ? "1 Public Address"
      : `${affectedPublicAddressCount} Public Addresses`;

  return (
    <CanvasNode.CopyableRow
      className={cn(
        "relative flex min-h-17 min-w-0 items-center justify-between gap-2 rounded-lg bg-white/5 px-2.5 py-2 transition-colors",
        copyable && "hover:bg-input"
      )}
      copyAriaLabel="Copy Private Address"
      copyable={copyable}
      copyValue={address}
      rowKey={rowKey}
      title={copyable ? address : undefined}
    >
      {({ copyable: rowCopyable }) => (
        <>
          <div
            aria-hidden={rowCopyable ? true : undefined}
            className={cn(
              "relative z-10 grid min-w-0 flex-1 gap-2",
              rowCopyable ? "pointer-events-none" : "pointer-events-auto"
            )}
          >
            <div className="flex min-w-0 items-center gap-1.5 text-foreground text-sm leading-5">
              <span className="min-w-0 truncate">
                {copyable ? address : "Pending"}
              </span>
              <CanvasNode.CopyableRowIndicator className="text-muted-foreground" />
            </div>
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground text-sm leading-5">
              <span className="shrink-0 tabular-nums">{port}</span>
              <span className="min-w-0 truncate">{countLabel}</span>
            </div>
          </div>
          <CanvasNode.CopyableRowControl className="relative z-20 flex shrink-0 items-center gap-2">
            {readOnly || onDelete == null ? null : (
              <AppIconButton
                aria-label={`Delete App Listening Port ${port}`}
                disabled={!canDelete}
                onClick={onDelete}
                size="lg"
                title={
                  canDelete
                    ? `Delete App Listening Port ${port}`
                    : "At least one App Listening Port is required"
                }
                type="button"
                variant="danger"
              >
                <Trash2 aria-hidden />
              </AppIconButton>
            )}
          </CanvasNode.CopyableRowControl>
        </>
      )}
    </CanvasNode.CopyableRow>
  );
}

interface DeletePortDialogTarget {
  affectedPublicAddresses: ContainerNetworkPublicAddress[];
  port: number;
}

interface DeletePortDialogProps {
  onConfirm: (port: number) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  target: DeletePortDialogTarget | null;
}

function DeletePortDialog({
  onConfirm,
  onOpenChange,
  open,
  target,
}: DeletePortDialogProps) {
  if (target == null) {
    return null;
  }
  const visible = target.affectedPublicAddresses.slice(0, 3);
  const remaining = Math.max(0, target.affectedPublicAddresses.length - 3);

  return (
    <AppDialog.Root onOpenChange={onOpenChange} open={open}>
      <AppDialog.Content data-slot="delete-app-listening-port-dialog">
        <AppDialog.Header>
          <AppDialog.WarningIcon />
          <AppDialog.Title>Delete App Listening Port?</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            Public Addresses targeting port {target.port} will be blocked until
            the port is added back or their target port changes.
          </AppDialog.Description>
          {visible.length === 0 ? null : (
            <div className="grid gap-1 text-muted-foreground text-sm">
              {visible.map((address) => (
                <div
                  className="min-w-0 truncate rounded-md bg-white/5 px-2 py-1"
                  key={
                    publicAddressIdValue(address) ||
                    publicAddressDisplayName(address)
                  }
                >
                  {publicAddressDisplayName(address)}
                </div>
              ))}
              {remaining === 0 ? null : (
                <div className="px-2 py-1">
                  +{remaining} more Public{" "}
                  {remaining === 1 ? "Address" : "Addresses"}
                </div>
              )}
            </div>
          )}
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel>Cancel</AppDialog.Cancel>
          <AppDialog.DestructiveAction
            onClick={() => onConfirm(target.port)}
            type="button"
          >
            Delete Port
          </AppDialog.DestructiveAction>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
}

interface AddAppListeningPortFormProps {
  existingPorts: readonly ContainerNetworkAppListeningPort[];
  onCancel: () => void;
  onSubmit: (port: number) => void;
}

function AddAppListeningPortForm({
  existingPorts,
  onCancel,
  onSubmit,
}: AddAppListeningPortFormProps) {
  const addressInputId = useId();
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const parsed = parsePortNumberDigits(draft.trim());
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    if (existingPorts.some((row) => Math.round(row.port) === parsed.n)) {
      setError("App Listening Port already exists.");
      return;
    }
    onSubmit(parsed.n);
    onCancel();
  };

  return (
    <div className="grid min-w-0 gap-4 rounded-lg border border-border border-dashed bg-transparent p-2.5">
      <AppInputField
        disabled
        id={addressInputId}
        label="Address"
        value="Pending address"
      />
      <AppInputField
        error={error}
        errorId={errorId}
        id={inputId}
        inputMode="numeric"
        label="Port"
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        placeholder="3000"
        value={draft}
      />
      <div className="flex min-w-0 justify-end gap-2">
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          onClick={onCancel}
          type="button"
          variant="quiet"
        >
          <X aria-hidden data-icon="inline-start" />
          Cancel
        </AppButton>
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          onClick={handleSubmit}
          type="button"
          variant="quiet"
        >
          <Plus aria-hidden data-icon="inline-start" />
          Add
        </AppButton>
      </div>
    </div>
  );
}

interface PublicAddressDraft extends ContainerNetworkPublicAddress {
  id: string;
  port: number;
}

interface AddPublicAddressFormProps {
  defaultPort: number;
  onCancel: () => void;
  onSubmit?: (
    address: PublicAddressDraft,
    customDomain?: ContainerNetworkCustomDomain
  ) => void | Promise<void>;
  platformAddressDraftContext?: ContainerNetworkPlatformAddressDraftContext;
  verify?: ContainerCustomDomainCnameVerifier;
}

async function verifiedCustomDomainDraft({
  cnameTarget,
  domain,
  platformAddressId,
  port,
  verify,
}: {
  cnameTarget: string;
  domain: string;
  platformAddressId: string;
  port: number;
  verify: ContainerCustomDomainCnameVerifier;
}): Promise<ContainerNetworkCustomDomain | { error: string }> {
  let result: ContainerCustomDomainCnameVerificationResult;
  try {
    result = await verify({ domain, target: cnameTarget });
  } catch (caught) {
    return {
      error:
        caught instanceof Error ? caught.message : "CNAME verification failed.",
    };
  }
  if (!result.ok) {
    return { error: result.message ?? "CNAME verification failed." };
  }
  return {
    cnameTarget,
    domain,
    id: generateCustomDomainBindingId(),
    platformAddressId,
    status: "verified",
    targetPort: port,
  };
}

interface PublicAddressEditFormProps {
  address: ContainerNetworkPublicAddress;
  onCancel: () => void;
  onSubmit?: (
    address: ContainerNetworkPublicAddress,
    port: number,
    customDomain?: ContainerNetworkCustomDomain
  ) => void | Promise<void>;
  verify?: ContainerCustomDomainCnameVerifier;
}

function PublicAddressEditForm({
  address,
  onCancel,
  onSubmit,
  verify,
}: PublicAddressEditFormProps) {
  const domainInputId = useId();
  const portInputId = useId();
  const cnameHostInputId = useId();
  const cnameTargetInputId = useId();
  const portErrorId = `${portInputId}-error`;
  const cnameErrorId = `${cnameHostInputId}-error`;
  const domainValue = publicAddressValue(address) || "Pending domain";
  const cnameTarget = publicAddressHostValue(address);
  const platformAddressId = publicAddressIdValue(address);
  const [draftPort, setDraftPort] = useState(() => String(address.port));
  const [cnameHostDraft, setCnameHostDraft] = useState("");
  const [portError, setPortError] = useState<string | null>(null);
  const [cnameError, setCnameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const normalizedCnameHost = normalizeCustomDomainDraft(cnameHostDraft);

  const handleSubmit = async () => {
    if (onSubmit == null) {
      return;
    }
    const parsedPort = parsePortNumberDigits(draftPort.trim());
    if (!parsedPort.ok) {
      setPortError(parsedPort.message);
      return;
    }
    if (normalizedCnameHost === "") {
      await onSubmit(address, parsedPort.n);
      onCancel();
      return;
    }
    if (cnameTarget === "" || platformAddressId === "") {
      setCnameError("Platform Address host is not ready.");
      return;
    }
    if (verify == null) {
      setCnameError("CNAME verification is unavailable.");
      return;
    }

    setPending(true);
    try {
      const verified = await verifiedCustomDomainDraft({
        cnameTarget,
        domain: normalizedCnameHost,
        platformAddressId,
        port: parsedPort.n,
        verify,
      });
      if ("error" in verified) {
        setCnameError(verified.error);
        return;
      }
      await onSubmit(address, parsedPort.n, verified);
      onCancel();
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-4 rounded-lg border border-border border-dashed bg-transparent p-2.5">
      <AppInputField
        disabled
        id={domainInputId}
        label="Domain"
        value={domainValue}
      />
      <AppInputField
        disabled={pending}
        error={portError}
        errorId={portErrorId}
        id={portInputId}
        inputMode="numeric"
        label="Port"
        onChange={(event) => {
          setDraftPort(event.target.value);
          setPortError(null);
        }}
        value={draftPort}
      />
      <AppInputField
        disabled={pending}
        error={cnameError}
        errorId={cnameErrorId}
        id={cnameHostInputId}
        label="Custom Domain"
        onChange={(event) => {
          setCnameHostDraft(event.target.value);
          setCnameError(null);
        }}
        placeholder="www.example.com"
        value={cnameHostDraft}
      />
      <AppInputField
        disabled
        id={cnameTargetInputId}
        label="CNAME Target"
        value={cnameTarget === "" ? "Pending domain" : cnameTarget}
      />
      <div className="flex min-w-0 justify-end gap-2">
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="quiet"
        >
          <X aria-hidden data-icon="inline-start" />
          Cancel
        </AppButton>
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={pending || onSubmit == null}
          onClick={handleSubmit}
          type="button"
          variant="quiet"
        >
          {pending ? "Verifying" : "Save"}
        </AppButton>
      </div>
    </div>
  );
}

function AddPublicAddressForm({
  defaultPort,
  onCancel,
  onSubmit,
  platformAddressDraftContext,
  verify,
}: AddPublicAddressFormProps) {
  const domainInputId = useId();
  const portInputId = useId();
  const cnameHostInputId = useId();
  const cnameTargetInputId = useId();
  const errorId = `${portInputId}-error`;
  const cnameErrorId = `${cnameHostInputId}-error`;
  const [draftAddress] = useState(() =>
    platformAddressDraftFromPort(defaultPort, platformAddressDraftContext)
  );
  const [draftPort, setDraftPort] = useState(() => String(defaultPort));
  const [cnameHostDraft, setCnameHostDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cnameError, setCnameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const domainValue = publicAddressHostValue(draftAddress) || "Pending domain";
  const cnameTarget = publicAddressHostValue(draftAddress);
  const normalizedCnameHost = normalizeCustomDomainDraft(cnameHostDraft);

  const handleSubmit = async () => {
    if (onSubmit == null) {
      return;
    }
    const parsedPort = parsePortNumberDigits(draftPort.trim());
    if (!parsedPort.ok) {
      setError(parsedPort.message);
      return;
    }
    if (normalizedCnameHost !== "" && cnameTarget === "") {
      setCnameError("Platform Address host is not ready.");
      return;
    }
    if (normalizedCnameHost !== "" && verify == null) {
      setCnameError("CNAME verification is unavailable.");
      return;
    }

    setPending(true);
    try {
      let customDomain: ContainerNetworkCustomDomain | undefined;
      if (normalizedCnameHost !== "") {
        const verifier = verify;
        if (verifier == null) {
          setCnameError("CNAME verification is unavailable.");
          return;
        }
        const verified = await verifiedCustomDomainDraft({
          cnameTarget,
          domain: normalizedCnameHost,
          platformAddressId: draftAddress.id,
          port: parsedPort.n,
          verify: verifier,
        });
        if ("error" in verified) {
          setCnameError(verified.error);
          return;
        }
        customDomain = verified;
      }
      await onSubmit({ ...draftAddress, port: parsedPort.n }, customDomain);
    } finally {
      setPending(false);
    }
    onCancel();
  };

  return (
    <div className="grid min-w-0 gap-4 rounded-lg border border-border border-dashed bg-transparent p-2.5">
      <AppInputField
        disabled
        id={domainInputId}
        label="Domain"
        value={domainValue}
      />
      <AppInputField
        disabled={pending}
        error={error}
        errorId={errorId}
        id={portInputId}
        inputMode="numeric"
        label="Port"
        onChange={(event) => {
          setDraftPort(event.target.value);
          setError(null);
        }}
        value={draftPort}
      />
      <AppInputField
        disabled={pending}
        error={cnameError}
        errorId={cnameErrorId}
        id={cnameHostInputId}
        label="CNAME Host"
        onChange={(event) => {
          setCnameHostDraft(event.target.value);
          setCnameError(null);
        }}
        placeholder="www.example.com"
        value={cnameHostDraft}
      />
      <AppInputField
        disabled
        id={cnameTargetInputId}
        label="CNAME Target"
        value={cnameTarget === "" ? "Pending domain" : cnameTarget}
      />
      <div className="flex min-w-0 justify-end gap-2">
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={pending}
          onClick={onCancel}
          type="button"
          variant="quiet"
        >
          <X aria-hidden data-icon="inline-start" />
          Cancel
        </AppButton>
        <AppButton
          className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
          disabled={pending || onSubmit == null}
          onClick={handleSubmit}
          type="button"
          variant="quiet"
        >
          <Plus aria-hidden data-icon="inline-start" />
          Add
        </AppButton>
      </div>
    </div>
  );
}

interface AddPublicAddressDraft {
  customDomain?: ContainerNetworkCustomDomain;
  publicAddress: PublicAddressDraft;
}

function networkWithAddedPublicAddressDraft(
  network: ContainerNetwork,
  draft: AddPublicAddressDraft
): ContainerNetwork {
  const next = {
    ...network,
    customDomains:
      draft.customDomain == null
        ? network.customDomains
        : [...(network.customDomains ?? []), draft.customDomain],
    publicAddresses: [...network.publicAddresses, draft.publicAddress],
  };
  return networkWithAppListeningPort(next, draft.publicAddress.port);
}

interface DomainListSectionProps {
  addOpen: boolean;
  canMutateNetwork: boolean;
  defaultPort: number;
  expandedCnameRowKeys: ReadonlySet<string>;
  onAddPublicAddress: (
    address: PublicAddressDraft,
    customDomain?: ContainerNetworkCustomDomain
  ) => void | Promise<void>;
  onBindAddress: (
    rowKey: string,
    address: ContainerNetworkPublicAddress,
    index: number,
    port: number,
    customDomain?: ContainerNetworkCustomDomain
  ) => void | Promise<void>;
  onCancelAddPublicAddress: () => void;
  onCancelBindAddress: (rowKey: string) => void;
  onCollapsePublicAddresses: () => void;
  onDeletePublicAddress: (index: number) => void | Promise<void>;
  onOpenAddPublicAddress: () => void;
  onOpenBindAddress: (rowKey: string) => void;
  onShowAllPublicAddresses: () => void;
  onUnbindCustomDomain: (
    domain: ContainerNetworkCustomDomain
  ) => void | Promise<void>;
  platformAddressDraftContext?: ContainerNetworkPlatformAddressDraftContext;
  readOnly: boolean;
  showAllPublicAddresses: boolean;
  verify?: ContainerCustomDomainCnameVerifier;
  visibleDomainRows: VisibleDomainRows;
  visiblePublicAddresses: ContainerNetworkPublicAddress[];
}

function DomainListSection({
  addOpen,
  canMutateNetwork,
  defaultPort,
  expandedCnameRowKeys,
  onAddPublicAddress,
  onBindAddress,
  onCancelBindAddress,
  onCancelAddPublicAddress,
  onCollapsePublicAddresses,
  onDeletePublicAddress,
  onOpenBindAddress,
  onOpenAddPublicAddress,
  onShowAllPublicAddresses,
  onUnbindCustomDomain,
  platformAddressDraftContext,
  readOnly,
  showAllPublicAddresses,
  verify,
  visibleDomainRows,
  visiblePublicAddresses,
}: DomainListSectionProps) {
  const noDomains =
    visibleDomainRows.publicAddresses.length === 0 &&
    visibleDomainRows.customDomains.length === 0;
  const hasPublicAddressOverflow =
    visibleDomainRows.publicAddresses.length > PUBLIC_ADDRESS_VISIBLE_COUNT;

  return (
    <NetworkCard title="Domain List">
      {readOnly ? null : (
        <AppButton
          aria-label="Add Public Address"
          className="h-9 w-full rounded-lg bg-white/5 text-muted-foreground text-sm hover:bg-input"
          disabled={addOpen || !canMutateNetwork}
          onClick={onOpenAddPublicAddress}
          type="button"
          variant="secondary"
        >
          <Plus aria-hidden />
          Add Domain
        </AppButton>
      )}
      {addOpen ? (
        <AddPublicAddressForm
          defaultPort={defaultPort}
          onCancel={onCancelAddPublicAddress}
          onSubmit={canMutateNetwork ? onAddPublicAddress : undefined}
          platformAddressDraftContext={platformAddressDraftContext}
          verify={verify}
        />
      ) : null}
      {noDomains ? (
        <div className="rounded-md border border-border border-dashed px-2.5 py-3 text-center text-muted-foreground text-xs">
          No public addresses yet
        </div>
      ) : (
        <CanvasNode.CopyFeedbackScope>
          <div className="grid gap-2">
            {visibleDomainRows.customDomains.map((domain, index) => (
              <CustomDomainRow
                domain={domain}
                key={customDomainKey(domain, index)}
                onUnbind={
                  canMutateNetwork
                    ? () => onUnbindCustomDomain(domain)
                    : undefined
                }
                readOnly={readOnly}
              />
            ))}
            {visiblePublicAddresses.map((address, index) => {
              const key = publicAddressKey(address, index);
              return expandedCnameRowKeys.has(key) ? (
                <PublicAddressEditForm
                  address={address}
                  key={key}
                  onCancel={() => onCancelBindAddress(key)}
                  onSubmit={
                    canMutateNetwork
                      ? (submittedAddress, port, customDomain) =>
                          onBindAddress(
                            key,
                            submittedAddress,
                            index,
                            port,
                            customDomain
                          )
                      : undefined
                  }
                  verify={verify}
                />
              ) : (
                <PublicAddressRow
                  address={address}
                  key={key}
                  onBindCustomDomain={
                    canMutateNetwork ? () => onOpenBindAddress(key) : undefined
                  }
                  onDelete={
                    canMutateNetwork
                      ? () => onDeletePublicAddress(index)
                      : undefined
                  }
                  readOnly={readOnly}
                  rowKey={key}
                />
              );
            })}
          </div>
        </CanvasNode.CopyFeedbackScope>
      )}
      {hasPublicAddressOverflow ? (
        <button
          aria-expanded={showAllPublicAddresses}
          aria-label={
            showAllPublicAddresses
              ? "Show Less Public Addresses"
              : "View All Public Addresses"
          }
          className="inline-flex h-5 shrink-0 cursor-pointer select-none items-center justify-center justify-self-center whitespace-nowrap rounded-lg border border-transparent bg-transparent bg-clip-padding px-2 font-medium text-muted-foreground text-xs leading-5 outline-none transition-colors hover:bg-input/30 hover:text-foreground focus-visible:border-ring focus-visible:bg-input/30 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={
            showAllPublicAddresses
              ? onCollapsePublicAddresses
              : onShowAllPublicAddresses
          }
          type="button"
        >
          {showAllPublicAddresses ? "Show Less" : "View All"}
        </button>
      ) : null}
    </NetworkCard>
  );
}

function NetworkSettingsSection({
  network,
  onCustomDomainCnameVerify,
  platformAddressDraftContext,
  onNetworkDraftChange,
  onNetworkChange,
  readOnly,
}: NetworkSettingsSectionProps) {
  const appListeningPorts = appListeningPortsFromNetwork(network);
  const [addPortOpen, setAddPortOpen] = useState(false);
  const [addPublicAddressOpen, setAddPublicAddressOpen] = useState(false);
  const [showAllPublicAddresses, setShowAllPublicAddresses] = useState(false);
  const [expandedCnameRowKeys, setExpandedCnameRowKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [deletePortTarget, setDeletePortTarget] =
    useState<DeletePortDialogTarget | null>(null);
  const visibleDomains = visibleDomainRows(network);
  const canMutateNetwork = canMutateNetworkDraft({
    onNetworkChange,
    onNetworkDraftChange,
    readOnly,
  });
  const visiblePublicAddresses = showAllPublicAddresses
    ? visibleDomains.publicAddresses
    : visibleDomains.publicAddresses.slice(0, PUBLIC_ADDRESS_VISIBLE_COUNT);

  useEffect(() => {
    if (visibleDomains.publicAddresses.length <= PUBLIC_ADDRESS_VISIBLE_COUNT) {
      setShowAllPublicAddresses(false);
    }
  }, [visibleDomains.publicAddresses.length]);

  const handleCancelAddPublicAddress = () => {
    setAddPublicAddressOpen(false);
  };

  const handleAddAppListeningPort = async (port: number) => {
    await commitNetworkChange(networkWithAppListeningPort(network, port), {
      onNetworkChange,
      onNetworkDraftChange,
    });
  };

  const commitDeleteAppListeningPort = async (port: number) => {
    await commitNetworkChange(networkWithoutAppListeningPort(network, port), {
      onNetworkChange,
      onNetworkDraftChange,
    });
  };

  const handleDeleteAppListeningPort = async (port: number) => {
    if (appListeningPorts.length <= 1) {
      return;
    }
    const affected = publicAddressesTargetingPort(network, port);
    if (affected.length > 0) {
      setDeletePortTarget({ affectedPublicAddresses: affected, port });
      return;
    }
    await commitDeleteAppListeningPort(port);
  };

  const handleConfirmDeleteAppListeningPort = async (port: number) => {
    setDeletePortTarget(null);
    await commitDeleteAppListeningPort(port);
  };

  const handleAddPublicAddress = async (
    address: PublicAddressDraft,
    customDomain?: ContainerNetworkCustomDomain
  ) => {
    await commitNetworkChange(
      networkWithAddedPublicAddressDraft(network, {
        customDomain,
        publicAddress: address,
      }),
      { onNetworkChange, onNetworkDraftChange }
    );
  };

  const handleDeletePublicAddress = async (index: number) => {
    const target = visibleDomains.publicAddresses[index];
    const publicAddresses = network.publicAddresses.filter(
      (address, itemIndex) =>
        !isPublicAddressDeleteTarget(address, itemIndex, target, index)
    );
    await commitNetworkChange(
      { ...network, publicAddresses },
      { onNetworkChange, onNetworkDraftChange }
    );
  };

  const handleOpenBindAddress = (rowKey: string) => {
    setExpandedCnameRowKeys((current) => new Set(current).add(rowKey));
  };

  const handleCancelBindAddress = (rowKey: string) => {
    setExpandedCnameRowKeys((current) => {
      const next = new Set(current);
      next.delete(rowKey);
      return next;
    });
  };

  const handleBindCustomDomain = async (
    rowKey: string,
    address: ContainerNetworkPublicAddress,
    index: number,
    port: number,
    domain?: ContainerNetworkCustomDomain
  ) => {
    await commitNetworkChange(
      containerNetworkAfterEditPublicAddress(network, {
        customDomain: domain,
        platformAddress: address,
        platformAddressIndex: index,
        port,
      }),
      { onNetworkChange, onNetworkDraftChange }
    );
    handleCancelBindAddress(rowKey);
  };

  const handleUnbindCustomDomain = async (
    domain: ContainerNetworkCustomDomain
  ) => {
    await commitNetworkChange(
      containerNetworkAfterUnbindCustomDomain(network, domain),
      { onNetworkChange, onNetworkDraftChange }
    );
  };

  return (
    <>
      <NetworkCard title="Private Addresses">
        {readOnly ? null : (
          <AppButton
            aria-label="Add App Listening Port"
            className="h-9 w-full rounded-lg bg-white/5 text-muted-foreground text-sm hover:bg-input"
            disabled={addPortOpen || !canMutateNetwork}
            onClick={() => setAddPortOpen(true)}
            type="button"
            variant="secondary"
          >
            <Plus aria-hidden />
            Add Port
          </AppButton>
        )}
        {addPortOpen ? (
          <AddAppListeningPortForm
            existingPorts={appListeningPorts}
            onCancel={() => setAddPortOpen(false)}
            onSubmit={handleAddAppListeningPort}
          />
        ) : null}
        <CanvasNode.CopyFeedbackScope>
          <div className="grid gap-2">
            {appListeningPorts.map((row) => (
              <PrivateAddressRow
                address={row.privateAddress ?? ""}
                affectedPublicAddressCount={
                  publicAddressesTargetingPort(network, row.port).length
                }
                canDelete={appListeningPorts.length > 1}
                key={`private-${row.port}`}
                onDelete={
                  canMutateNetwork
                    ? () => handleDeleteAppListeningPort(row.port)
                    : undefined
                }
                port={row.port}
                readOnly={readOnly}
                rowKey={`private-${row.port}`}
              />
            ))}
          </div>
        </CanvasNode.CopyFeedbackScope>
      </NetworkCard>

      <DomainListSection
        addOpen={addPublicAddressOpen}
        canMutateNetwork={canMutateNetwork}
        defaultPort={publicAddressDefaultPort(network)}
        expandedCnameRowKeys={expandedCnameRowKeys}
        onAddPublicAddress={handleAddPublicAddress}
        onBindAddress={handleBindCustomDomain}
        onCancelAddPublicAddress={handleCancelAddPublicAddress}
        onCancelBindAddress={handleCancelBindAddress}
        onCollapsePublicAddresses={() => setShowAllPublicAddresses(false)}
        onDeletePublicAddress={handleDeletePublicAddress}
        onOpenAddPublicAddress={() => setAddPublicAddressOpen(true)}
        onOpenBindAddress={handleOpenBindAddress}
        onShowAllPublicAddresses={() => setShowAllPublicAddresses(true)}
        onUnbindCustomDomain={handleUnbindCustomDomain}
        platformAddressDraftContext={platformAddressDraftContext}
        readOnly={readOnly}
        showAllPublicAddresses={showAllPublicAddresses}
        verify={onCustomDomainCnameVerify}
        visibleDomainRows={visibleDomains}
        visiblePublicAddresses={visiblePublicAddresses}
      />
      <DeletePortDialog
        onConfirm={handleConfirmDeleteAppListeningPort}
        onOpenChange={(open) => {
          if (!open) {
            setDeletePortTarget(null);
          }
        }}
        open={deletePortTarget != null}
        target={deletePortTarget}
      />
    </>
  );
}

function publicAddressNetworkDirty(
  base: ContainerNetwork,
  draft: ContainerNetwork
): boolean {
  return !containerNetworksEqual(base, draft);
}

export function ContainerPublicAddressesSettingsPane({
  className,
  identityKey,
  network,
  networkPlatformAddressDraftContext,
  onCustomDomainCnameVerify,
  onNetworkDraftCommit,
  onSettingsDraftLeaveGuardChange,
  readOnly = false,
}: ContainerPublicAddressesSettingsPaneProps) {
  const commitMode = onNetworkDraftCommit != null && readOnly !== true;
  const [draftNetwork, setDraftNetwork] = useState(network);
  const [savePending, setSavePending] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [portNotice, setPortNotice] = useState<string | null>(null);
  const [showAllPublicAddresses, setShowAllPublicAddresses] = useState(false);
  const [expandedCnameRowKeys, setExpandedCnameRowKeys] = useState<
    ReadonlySet<string>
  >(() => new Set());

  useEffect(() => {
    if (commitMode) {
      return;
    }
    setDraftNetwork(network);
  }, [commitMode, network]);

  const networkBackingKey = useMemo(
    () => containerNetworkDraftBackingKey(network),
    [network]
  );
  const [networkBackingState, setNetworkBackingState] = useState(() =>
    createSettingsDraftBackingState(network, networkBackingKey, identityKey)
  );
  const applyNetworkDraftToLocalState = useCallback(
    (next: ContainerNetwork) => {
      setDraftNetwork(next);
    },
    []
  );

  useEffect(() => {
    if (!commitMode) {
      return;
    }
    const synced = syncSettingsDraftBackingState(networkBackingState, {
      backing: network,
      backingKey: networkBackingKey,
      draft: draftNetwork,
      identityKey,
      isDirty: publicAddressNetworkDirty,
    });
    if (synced.state === networkBackingState && synced.draft === undefined) {
      return;
    }
    applySettingsDraftBackingResult(synced, {
      draft: applyNetworkDraftToLocalState,
      state: setNetworkBackingState,
    });
  }, [
    applyNetworkDraftToLocalState,
    commitMode,
    draftNetwork,
    identityKey,
    network,
    networkBackingKey,
    networkBackingState,
  ]);

  const networkForRender = commitMode ? draftNetwork : network;
  const visibleDomains = visibleDomainRows(networkForRender);
  const visiblePublicAddresses = showAllPublicAddresses
    ? visibleDomains.publicAddresses
    : visibleDomains.publicAddresses.slice(0, PUBLIC_ADDRESS_VISIBLE_COUNT);
  const networkDirty = publicAddressNetworkDirty(
    networkBackingState.base,
    draftNetwork
  );
  const canSave = commitMode && networkDirty && !savePending;
  const canMutateNetwork = commitMode;

  useEffect(() => {
    if (visibleDomains.publicAddresses.length <= PUBLIC_ADDRESS_VISIBLE_COUNT) {
      setShowAllPublicAddresses(false);
    }
  }, [visibleDomains.publicAddresses.length]);

  const resetNetworkDraft = useCallback(() => {
    applyNetworkDraftToLocalState(networkBackingState.base);
    setNetworkBackingState((current) => ({
      ...current,
      saveFailureMessage: null,
    }));
  }, [applyNetworkDraftToLocalState, networkBackingState.base]);

  const reloadNetworkDraft = useCallback(() => {
    applySettingsDraftBackingResult(
      reloadSettingsDraftBackingState(networkBackingState),
      {
        draft: applyNetworkDraftToLocalState,
        state: setNetworkBackingState,
      }
    );
  }, [applyNetworkDraftToLocalState, networkBackingState]);

  const keepEditingNetworkDraft = useCallback(() => {
    setNetworkBackingState((current) =>
      keepEditingSettingsDraftBackingState(current)
    );
  }, []);

  const saveNetworkDraft = useCallback(async () => {
    if (!canSave || onNetworkDraftCommit == null) {
      throw new Error("Public Address draft cannot be saved yet.");
    }
    const draft = draftNetwork;
    setSavePending(true);
    setNetworkBackingState((current) => ({
      ...current,
      saveFailureMessage: null,
    }));
    try {
      await onNetworkDraftCommit(draft, {
        baseNetwork: networkBackingState.base,
      });
      setNetworkBackingState((current) =>
        commitSettingsDraftBackingState(current, draft)
      );
    } catch (error) {
      setNetworkBackingState((current) =>
        failSettingsDraftSave(
          current,
          error,
          "Could not save public addresses."
        )
      );
      throw error;
    } finally {
      setSavePending(false);
    }
  }, [canSave, draftNetwork, networkBackingState.base, onNetworkDraftCommit]);

  const handleSaveNetworkDraft = useCallback(async () => {
    try {
      await saveNetworkDraft();
    } catch {
      // The footer keeps the user on the draft and shows the panel-level failure.
    }
  }, [saveNetworkDraft]);

  const applyPublicAddressDraftNetwork = useCallback(
    (next: ContainerNetwork) => {
      const addedPorts = addedAppListeningPorts(networkForRender, next);
      if (addedPorts.length > 0) {
        setPortNotice(`Port ${addedPorts[0]} added to Private Addresses.`);
      }
      setDraftNetwork(next);
    },
    [networkForRender]
  );

  useEffect(() => {
    if (!commitMode || onSettingsDraftLeaveGuardChange == null) {
      return;
    }

    onSettingsDraftLeaveGuardChange(
      networkDirty
        ? {
            canSave,
            dirty: true,
            discard: resetNetworkDraft,
            save: saveNetworkDraft,
            scope: "publicAddresses",
          }
        : null
    );

    return () => {
      onSettingsDraftLeaveGuardChange(null);
    };
  }, [
    canSave,
    commitMode,
    networkDirty,
    onSettingsDraftLeaveGuardChange,
    resetNetworkDraft,
    saveNetworkDraft,
  ]);

  const handleAddPublicAddress = (
    address: PublicAddressDraft,
    customDomain?: ContainerNetworkCustomDomain
  ) => {
    applyPublicAddressDraftNetwork(
      networkWithAddedPublicAddressDraft(networkForRender, {
        customDomain,
        publicAddress: address,
      })
    );
  };

  const handleDeletePublicAddress = (index: number) => {
    const target = visibleDomains.publicAddresses[index];
    const publicAddresses = networkForRender.publicAddresses.filter(
      (address, itemIndex) =>
        !isPublicAddressDeleteTarget(address, itemIndex, target, index)
    );
    setDraftNetwork({ ...networkForRender, publicAddresses });
  };

  const handleOpenBindAddress = (rowKey: string) => {
    setExpandedCnameRowKeys((current) => new Set(current).add(rowKey));
  };

  const handleCancelBindAddress = (rowKey: string) => {
    setExpandedCnameRowKeys((current) => {
      const next = new Set(current);
      next.delete(rowKey);
      return next;
    });
  };

  const handleBindCustomDomain = (
    rowKey: string,
    address: ContainerNetworkPublicAddress,
    index: number,
    port: number,
    domain?: ContainerNetworkCustomDomain
  ) => {
    applyPublicAddressDraftNetwork(
      containerNetworkAfterEditPublicAddress(networkForRender, {
        customDomain: domain,
        platformAddress: address,
        platformAddressIndex: index,
        port,
      })
    );
    handleCancelBindAddress(rowKey);
  };

  const handleUnbindCustomDomain = (domain: ContainerNetworkCustomDomain) => {
    setDraftNetwork(
      containerNetworkAfterUnbindCustomDomain(networkForRender, domain)
    );
  };

  return (
    <div
      className={cn(
        "dark flex w-full flex-col gap-5 text-muted-foreground",
        className
      )}
      data-slot="container-public-addresses-settings-pane"
    >
      <DomainListSection
        addOpen={addOpen}
        canMutateNetwork={canMutateNetwork}
        defaultPort={networkForRender.privatePort}
        expandedCnameRowKeys={expandedCnameRowKeys}
        onAddPublicAddress={handleAddPublicAddress}
        onBindAddress={handleBindCustomDomain}
        onCancelAddPublicAddress={() => setAddOpen(false)}
        onCancelBindAddress={handleCancelBindAddress}
        onCollapsePublicAddresses={() => setShowAllPublicAddresses(false)}
        onDeletePublicAddress={handleDeletePublicAddress}
        onOpenAddPublicAddress={() => setAddOpen(true)}
        onOpenBindAddress={handleOpenBindAddress}
        onShowAllPublicAddresses={() => setShowAllPublicAddresses(true)}
        onUnbindCustomDomain={handleUnbindCustomDomain}
        platformAddressDraftContext={networkPlatformAddressDraftContext}
        readOnly={readOnly}
        showAllPublicAddresses={showAllPublicAddresses}
        verify={onCustomDomainCnameVerify}
        visibleDomainRows={visibleDomains}
        visiblePublicAddresses={visiblePublicAddresses}
      />
      {portNotice == null ? null : (
        <p className="text-muted-foreground text-sm" role="status">
          {portNotice}
        </p>
      )}
      {commitMode ? (
        <ContainerSettingsDraftFooter
          backingResourceChanged={networkBackingState.resourceChanged}
          canSave={canSave}
          dirty={networkDirty}
          discardAriaLabel="Discard Public Address changes"
          onCancel={resetNetworkDraft}
          onKeepEditing={keepEditingNetworkDraft}
          onReload={reloadNetworkDraft}
          onSave={handleSaveNetworkDraft}
          pending={savePending}
          saveFailureMessage={networkBackingState.saveFailureMessage}
          submitAriaLabel="Update Public Address settings"
          unsavedMessage="Pending Public Address changes. Update to apply."
        />
      ) : null}
    </div>
  );
}

interface ReplicaStrategySectionProps {
  actions?: ReactNode;
  elastic: ContainerElasticReplicaSettings;
  fixedReplicasSliderParts: {
    onReplicasQuotaChange: (value: number) => void;
    replicasValue: number;
    rest: Omit<
      ContainerSettingsControlledQuotaProps,
      "onValueChange" | "value"
    >;
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
  elastic: ContainerElasticReplicaSettings,
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
  elastic: ContainerElasticReplicaSettings;
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
    { label: "Minimum replicas", value: formatReplicaValue(minReplicas) },
    { label: "Maximum replicas", value: formatReplicaValue(maxReplicas) },
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

interface ReadOnlyReplicaStrategySummaryProps {
  rows: readonly ReadOnlyReplicaValueProps[];
}

function ReadOnlyReplicaStrategySummary({
  rows,
}: ReadOnlyReplicaStrategySummaryProps) {
  return (
    <ResourceSettingsSection title="Replica Strategy">
      <div className="grid min-w-0 gap-2">
        {rows.map((row) => (
          <ReadOnlyReplicaValue
            key={row.label}
            label={row.label}
            value={row.value}
          />
        ))}
      </div>
    </ResourceSettingsSection>
  );
}

function ScalingTargetSlider({
  cpuTargetPercent,
  disabled,
  memoryTargetMib,
  onCpuTargetChange,
  onMemoryTargetChange,
  onTargetMetricChange,
  targetMetric,
}: {
  cpuTargetPercent: number;
  disabled: boolean;
  memoryTargetMib: number;
  onCpuTargetChange: (value: number) => void;
  onMemoryTargetChange: (value: number) => void;
  onTargetMetricChange: (metric: ElasticTargetMetric) => void;
  targetMetric: ElasticTargetMetric;
}) {
  const config =
    targetMetric === "memory"
      ? {
          ariaLabel: "Memory average target",
          displayValue: memoryMibDisplayValue(memoryTargetMib),
          format: formatMemoryMibValue,
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
          max: CPU_UTILIZATION_TARGET_LIMITS.max,
          maxDecimals: 0,
          min: CPU_UTILIZATION_TARGET_LIMITS.min,
          onChange: onCpuTargetChange,
          value: cpuTargetPercent,
          valueSuffix: "%",
        };

  return (
    <ResourceSettingsInset>
      <SettingsSlider.Root
        disabled={disabled}
        displayValue={config.displayValue}
        formatBound={config.format}
        max={config.max}
        maxDecimals={config.maxDecimals}
        min={config.min}
        onValueChange={config.onChange}
        step={1}
        value={config.value}
        valueSuffix={config.valueSuffix}
      >
        <SettingsSlider.Stack>
          <SettingsSlider.Header>
            <SlidingToggle
              ariaLabel="Scaling target"
              className="h-8 w-auto"
              disabled={disabled}
              indicatorClassName="rounded-md bg-white/5"
              itemClassName="!rounded-md h-8 min-w-0 px-3 text-xs data-[state=on]:text-foreground text-muted-foreground"
              onValueChange={onTargetMetricChange}
              options={SCALING_TARGET_TOGGLE_OPTIONS}
              value={targetMetric}
            />
            <SettingsSlider.Value />
          </SettingsSlider.Header>
          <SettingsSlider.Control aria-label={config.ariaLabel}>
            <SettingsSlider.Track>
              <SettingsSlider.Range />
            </SettingsSlider.Track>
            <SettingsSlider.Thumb />
          </SettingsSlider.Control>
          <SettingsSlider.Bounds />
        </SettingsSlider.Stack>
      </SettingsSlider.Root>
    </ResourceSettingsInset>
  );
}

function ReplicaStrategySection({
  actions,
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
}: ReplicaStrategySectionProps) {
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

  if (readOnly) {
    return (
      <ReadOnlyReplicaStrategySummary
        rows={readOnlyReplicaStrategyRows({
          cpuTargetPercent,
          elastic,
          fixedReplicas: fixedReplicasSliderParts.replicasValue,
          maxReplicas,
          memoryTargetMib,
          minReplicas,
          strategyType,
          targetMetric,
        })}
      />
    );
  }

  return (
    <ResourceSettingsSection actions={actions} title="Replica Strategy">
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
                ariaLabel="Minimum replicas"
                disabled={readOnly}
                formatBound={formatReplicaValue}
                label="Minimum replicas"
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
                ariaLabel="Maximum replicas"
                disabled={readOnly}
                formatBound={formatReplicaValue}
                label="Maximum replicas"
                max={REPLICA_LIMITS.max}
                maxDecimals={0}
                min={REPLICA_LIMITS.min}
                onValueChange={onElasticMaxReplicasChange}
                step={1}
                value={maxReplicas}
              />
            </ResourceSettingsInset>

            <ScalingTargetSlider
              cpuTargetPercent={cpuTargetPercent}
              disabled={readOnly}
              memoryTargetMib={memoryTargetMib}
              onCpuTargetChange={onElasticCpuTargetChange}
              onMemoryTargetChange={onElasticMemoryTargetChange}
              onTargetMetricChange={onElasticTargetMetricChange}
              targetMetric={targetMetric}
            />
          </div>
        )}
      </div>
    </ResourceSettingsSection>
  );
}

function ImageSettingsSection({
  imageInputId,
  onBlur,
  onChange,
  readOnly,
  value,
}: {
  imageInputId: string;
  onBlur: () => void;
  onChange: (image: string) => void;
  readOnly: boolean;
  value: string;
}) {
  const shownImage = value.trim() === "" ? "No image configured" : value;

  return (
    <ResourceSettingsSection icon={SquarePen} title="Image">
      <div className="flex min-w-0 flex-col gap-2">
        <Label
          className="text-foreground text-sm leading-none"
          htmlFor={imageInputId}
        >
          Image
        </Label>
        {readOnly ? (
          <div
            className="flex h-9 min-w-0 items-center overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-muted-foreground text-sm leading-5"
            title={shownImage}
          >
            <span className="min-w-0 truncate">{shownImage}</span>
          </div>
        ) : (
          <AppInput
            aria-label="Container image"
            id={imageInputId}
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value)}
            placeholder="ghcr.io/org/app:1.0.0"
            title={shownImage}
            value={value}
          />
        )}
      </div>
    </ResourceSettingsSection>
  );
}

function ContainerSettingsDraftFooter({
  backingResourceChanged,
  canSave,
  dirty,
  discardAriaLabel = "Discard settings changes",
  onCancel,
  onKeepEditing,
  onReload,
  onSave,
  pending,
  saveFailureMessage,
  submitAriaLabel = "Update settings",
  submitLabel,
  unsavedMessage,
}: {
  backingResourceChanged: boolean;
  canSave: boolean;
  dirty: boolean;
  discardAriaLabel?: string;
  onCancel: () => void;
  onKeepEditing: () => void;
  onReload: () => void;
  onSave: () => void | Promise<void>;
  pending: boolean;
  saveFailureMessage: string | null;
  submitAriaLabel?: string;
  submitLabel?: string;
  unsavedMessage?: string;
}) {
  return (
    <ResourceSettingsDraftFooter
      backingResourceChanged={backingResourceChanged}
      cancelAriaLabel={discardAriaLabel}
      canSubmit={canSave}
      className="p-2.5"
      data-slot="container-settings-draft-actions"
      dirty={dirty}
      onCancel={onCancel}
      onKeepEditing={onKeepEditing}
      onReload={onReload}
      onSubmit={onSave}
      pending={pending}
      saveFailureMessage={saveFailureMessage}
      submitAriaLabel={submitAriaLabel}
      submitLabel={submitLabel}
      unsavedMessage={unsavedMessage}
    />
  );
}

/**
 * Structured readout for workload settings: container image, CPU/memory quota sliders,
 * optional replica count, environment variables, and AP Network settings.
 * All fields are controlled by the host.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: coordinates several controlled AP settings sections plus legacy section commit props.
export function ContainerSettingsPane({
  addDbDsnReferenceIntent,
  className,
  image,
  onImageChange,
  onNetworkChange,
  onEnvChange,
  onAddDbDsnReferenceIntentConsumed,
  onAddDbDsnReferenceIntentDraftChange,
  cpuQuota,
  memoryQuota,
  env,
  network,
  networkPlatformAddressDraftContext,
  onCustomDomainCnameVerify,
  replicasQuota,
  replicaStrategy,
  onResourceQuotasCommit,
  onSettingsDraftCommit,
  onSettingsDraftLeaveGuardChange,
  readOnly = false,
  dbDsnReferenceSources = [],
  sectionFocus = "all",
  showImageSection = true,
}: ContainerSettingsPaneProps) {
  const [draftImage, setDraftImage] = useState(image);
  const [quotaSavePending, setQuotaSavePending] = useState(false);
  const [settingsSavePending, setSettingsSavePending] = useState(false);
  const [draftNetwork, setDraftNetwork] = useState<
    ContainerNetwork | undefined
  >(network);
  const imageInputId = useId();
  const envDraftKeyPrefix = useId();
  const envDraftKeyCounter = useRef(0);
  const initialEnvDraft = useMemo(
    () =>
      envDraftWithAddReferenceIntent({
        intent: addDbDsnReferenceIntent,
        readOnly,
        rows: containerEnvRowsFromSavedEnv(env, dbDsnReferenceSources),
        sources: dbDsnReferenceSources,
      }),
    [addDbDsnReferenceIntent, dbDsnReferenceSources, env, readOnly]
  );
  const processedAddDbDsnReferenceIntentId = useRef<string | null>(
    initialEnvDraft.consumedIntentId ?? null
  );
  const syncedEnvRef = useRef<readonly ContainerEnvVar[]>(env);
  const [envDraft, setEnvDraft] = useState<EnvDraftRow[]>(
    () => initialEnvDraft.rows
  );
  const [envDraftKeys, setEnvDraftKeys] = useState<string[]>(() =>
    createEnvDraftKeys(
      initialEnvDraft.rows.length,
      envDraftKeyPrefix,
      envDraftKeyCounter
    )
  );
  const previousAddDbDsnReferenceIntentIds = useRef<Set<string>>(new Set());

  const settingsCommitMode = onSettingsDraftCommit != null && readOnly !== true;
  const quotaCommitMode = onResourceQuotasCommit != null && readOnly !== true;
  const quotaDraftMode = settingsCommitMode || quotaCommitMode;

  const [draftCpu, setDraftCpu] = useState(cpuQuota.value);
  const [draftMem, setDraftMem] = useState(memoryQuota.value);
  const [draftReplicaStrategy, setDraftReplicaStrategy] = useState(() =>
    normalizeReplicaStrategy(
      replicaStrategy,
      replicasQuota?.value ?? DEFAULT_FIXED_REPLICAS
    )
  );

  useEffect(() => {
    if (settingsCommitMode) {
      return;
    }
    setDraftImage(image);
  }, [image, settingsCommitMode]);

  useEffect(() => {
    if (settingsCommitMode) {
      return;
    }
    setDraftNetwork(network);
  }, [network, settingsCommitMode]);

  useEffect(() => {
    if (settingsCommitMode) {
      return;
    }
    setDraftCpu(cpuQuota.value);
    setDraftMem(memoryQuota.value);
    setDraftReplicaStrategy(
      normalizeReplicaStrategy(
        replicaStrategy,
        replicasQuota?.value ?? DEFAULT_FIXED_REPLICAS
      )
    );
  }, [
    cpuQuota.value,
    memoryQuota.value,
    replicaStrategy,
    replicasQuota,
    settingsCommitMode,
  ]);

  useEffect(() => {
    if (settingsCommitMode) {
      return;
    }
    if (containerEnvRowsModelEqual(env, syncedEnvRef.current)) {
      return;
    }
    syncedEnvRef.current = env;
    const nextEnv = containerEnvRowsFromSavedEnv(env, dbDsnReferenceSources);
    setEnvDraft(nextEnv);
    setEnvDraftKeys(
      createEnvDraftKeys(nextEnv.length, envDraftKeyPrefix, envDraftKeyCounter)
    );
  }, [dbDsnReferenceSources, env, envDraftKeyPrefix, settingsCommitMode]);

  useEffect(() => {
    const intent = addDbDsnReferenceIntent;
    if (intent == null || readOnly) {
      return;
    }
    if (processedAddDbDsnReferenceIntentId.current === intent.id) {
      onAddDbDsnReferenceIntentConsumed?.(intent.id);
      return;
    }

    const source = dbDsnSourceFromAddReferenceIntent(
      dbDsnReferenceSources,
      intent
    );
    processedAddDbDsnReferenceIntentId.current = intent.id;
    onAddDbDsnReferenceIntentConsumed?.(intent.id);
    if (source === undefined) {
      return;
    }

    setEnvDraft((rows) => appendDbDsnReferenceIntentRow(rows, source, intent));
    setEnvDraftKeys((keys) => [
      ...keys,
      nextEnvDraftKey(envDraftKeyPrefix, envDraftKeyCounter),
    ]);
  }, [
    addDbDsnReferenceIntent,
    dbDsnReferenceSources,
    envDraftKeyPrefix,
    onAddDbDsnReferenceIntentConsumed,
    readOnly,
  ]);

  const quotasDirty = resourceQuotasDirty(
    draftCpu,
    draftMem,
    cpuQuota.value,
    memoryQuota.value,
    replicasQuota == null
      ? undefined
      : {
          committed: normalizeReplicaStrategy(
            replicaStrategy,
            replicasQuota.value
          ),
          draft: draftReplicaStrategy,
        }
  );

  const handleQuotaCancel = () => {
    setDraftCpu(cpuQuota.value);
    setDraftMem(memoryQuota.value);
    setDraftReplicaStrategy(
      normalizeReplicaStrategy(
        replicaStrategy,
        replicasQuota?.value ?? DEFAULT_FIXED_REPLICAS
      )
    );
  };

  const handleQuotaSave = async () => {
    if (onResourceQuotasCommit == null) {
      return;
    }
    const replicaPatch = resourceQuotaReplicaPatchFromDraft(
      replicasQuota != null,
      draftReplicaStrategy
    );
    setQuotaSavePending(true);
    try {
      await onResourceQuotasCommit({
        cpu: draftCpu,
        memory: draftMem,
        ...replicaPatch,
      });
    } finally {
      setQuotaSavePending(false);
    }
  };

  const envValidation = useMemo(
    () => validateContainerEnvRows(envDraft),
    [envDraft]
  );
  useEffect(() => {
    if (onAddDbDsnReferenceIntentDraftChange == null) {
      return;
    }

    const currentIds = new Set<string>();
    for (const row of envDraft) {
      const intentId = row.canvasAddDbDsnReferenceIntentId;
      if (intentId != null && intentId !== "") {
        currentIds.add(intentId);
      }
    }

    const confirmedReferences =
      confirmedAddDbDsnReferencesFromEnvDraft(envDraft);
    for (const id of currentIds) {
      onAddDbDsnReferenceIntentDraftChange({
        id,
        references: confirmedReferences.filter(
          (reference) => reference.id === id
        ),
      });
    }

    for (const id of previousAddDbDsnReferenceIntentIds.current) {
      if (!currentIds.has(id)) {
        onAddDbDsnReferenceIntentDraftChange({ id, references: [] });
      }
    }
    previousAddDbDsnReferenceIntentIds.current = currentIds;
  }, [envDraft, onAddDbDsnReferenceIntentDraftChange]);
  const envTokenDiagnostics = useMemo(
    () =>
      refreshContainerEnvTokenDraft(envDraft, dbDsnReferenceSources)
        .diagnostics,
    [dbDsnReferenceSources, envDraft]
  );
  const envErrorsByIndex = useMemo(() => {
    const byIndex = new Map<number, string>();
    for (const error of envValidation.errors) {
      if (!byIndex.has(error.index)) {
        byIndex.set(error.index, error.message);
      }
    }
    return byIndex;
  }, [envValidation]);
  const envDirty = !containerEnvRowsEqual(envDraft, env);
  const canSaveEnv =
    envDirty && envValidation.valid && envTokenDiagnostics.length === 0;
  const activeDraftNetwork = settingsCommitMode
    ? draftNetwork
    : (draftNetwork ?? network);
  const settingsDraftNetwork = activeDraftNetwork;
  const committedReplicaStrategy = useMemo(
    () =>
      replicasQuota == null
        ? undefined
        : normalizeReplicaStrategy(replicaStrategy, replicasQuota.value),
    [replicaStrategy, replicasQuota]
  );
  const originalSettingsDraft = useMemo<ContainerSettingsDraft>(
    () =>
      containerSettingsDraftFromValues({
        cpuCores: cpuQuota.value,
        env,
        image,
        memoryMib: memoryQuota.value,
        network,
        replicaStrategy: committedReplicaStrategy,
      }),
    [
      committedReplicaStrategy,
      cpuQuota.value,
      env,
      image,
      memoryQuota.value,
      network,
    ]
  );
  const originalSettingsDraftKey = useMemo(
    () => containerSettingsDraftBackingKey(originalSettingsDraft),
    [originalSettingsDraft]
  );
  const settingsDraft = useMemo<ContainerSettingsDraft>(
    () =>
      containerSettingsDraftFromValues({
        cpuCores: draftCpu,
        env: envDraft,
        image: draftImage,
        memoryMib: draftMem,
        network: settingsDraftNetwork,
        replicaStrategy:
          replicasQuota == null ? undefined : draftReplicaStrategy,
      }),
    [
      draftCpu,
      draftImage,
      draftMem,
      draftReplicaStrategy,
      envDraft,
      replicasQuota,
      settingsDraftNetwork,
    ]
  );
  const [settingsBackingState, setSettingsBackingState] = useState(() =>
    createSettingsDraftBackingState(
      originalSettingsDraft,
      originalSettingsDraftKey
    )
  );
  const applySettingsDraftToLocalState = useCallback(
    (next: ContainerSettingsDraft) => {
      setDraftImage(next.image);
      setDraftCpu(next.cpuCores);
      setDraftMem(next.memoryMib);
      setDraftReplicaStrategy(
        normalizeReplicaStrategy(
          next.replicaStrategy,
          next.replicas ?? replicasQuota?.value ?? DEFAULT_FIXED_REPLICAS
        )
      );
      const nextEnv = containerEnvRowsFromSavedEnv(
        next.env.map((row) => ({ ...row })),
        dbDsnReferenceSources
      );
      setEnvDraft(nextEnv);
      setEnvDraftKeys(
        createEnvDraftKeys(
          nextEnv.length,
          envDraftKeyPrefix,
          envDraftKeyCounter
        )
      );
      syncedEnvRef.current = nextEnv;
      setDraftNetwork(next.network);
    },
    [dbDsnReferenceSources, envDraftKeyPrefix, replicasQuota?.value]
  );
  useEffect(() => {
    if (!settingsCommitMode) {
      return;
    }
    const synced = syncSettingsDraftBackingState(settingsBackingState, {
      backing: originalSettingsDraft,
      backingKey: originalSettingsDraftKey,
      draft: settingsDraft,
      isDirty: containerSettingsDraftIsDirty,
    });
    if (synced.state === settingsBackingState && synced.draft === undefined) {
      return;
    }
    applySettingsDraftBackingResult(synced, {
      draft: applySettingsDraftToLocalState,
      state: setSettingsBackingState,
    });
  }, [
    applySettingsDraftToLocalState,
    originalSettingsDraft,
    originalSettingsDraftKey,
    settingsBackingState,
    settingsCommitMode,
    settingsDraft,
  ]);
  const settingsBaseDraft = settingsBackingState.base;
  const settingsDirty = containerSettingsDraftIsDirty(
    settingsBaseDraft,
    settingsDraft
  );
  const panelDraftDirty = settingsDirty;
  const canSaveSettings =
    settingsCommitMode &&
    panelDraftDirty &&
    envValidation.valid &&
    envTokenDiagnostics.length === 0 &&
    !settingsSavePending;

  const cpuSlider = useMemo(() => {
    const base = {
      min: 0.25,
      max: 16,
      step: 0.25,
      ...cpuQuota,
      ...(readOnly ? { disabled: true } : {}),
    };
    if (quotaDraftMode) {
      return {
        ...base,
        onValueChange: setDraftCpu,
        value: draftCpu,
      };
    }
    return base;
  }, [cpuQuota, draftCpu, quotaDraftMode, readOnly]);

  const memorySlider = useMemo(() => {
    const base = {
      min: 512,
      max: 8192,
      step: 128,
      ...memoryQuota,
      ...(readOnly ? { disabled: true } : {}),
    };
    if (quotaDraftMode) {
      return {
        ...base,
        onValueChange: setDraftMem,
        value: draftMem,
      };
    }
    return base;
  }, [draftMem, memoryQuota, quotaDraftMode, readOnly]);

  const replicasSlider = useMemo(() => {
    if (replicasQuota == null) {
      return null;
    }
    const base = {
      min: REPLICA_LIMITS.min,
      max: REPLICA_LIMITS.max,
      step: 1,
      ...replicasQuota,
      ...(readOnly ? { disabled: true } : {}),
    };
    if (quotaDraftMode) {
      return {
        ...base,
        onValueChange: (value: number) => {
          setDraftReplicaStrategy((current) => ({
            ...current,
            fixed: normalizeFixedReplicaSettings(value),
          }));
        },
        value: draftReplicaStrategy.fixed.replicas,
      };
    }
    return base;
  }, [
    draftReplicaStrategy.fixed.replicas,
    quotaDraftMode,
    readOnly,
    replicasQuota,
  ]);

  const replicasSliderParts = useMemo(() => {
    if (replicasSlider == null) {
      return null;
    }
    const {
      value: replicasValueRaw,
      onValueChange: onReplicasQuotaChange,
      ...rest
    } = replicasSlider;
    return {
      onReplicasQuotaChange,
      replicasValue: clampScale(
        replicasValueRaw,
        replicasSlider.min,
        replicasSlider.max
      ),
      rest,
    };
  }, [replicasSlider]);
  const handleReplicaStrategyTypeChange = (type: ReplicaStrategyType) => {
    setDraftReplicaStrategy((current) => {
      return replicaStrategyWithType(current, type);
    });
  };

  const handleElasticMinReplicasChange = (value: number) => {
    setDraftReplicaStrategy((current) => {
      const elastic = normalizeElasticReplicaSettings(
        elasticSettingsFromStrategy(current)
      );
      const minReplicas = normalizeReplicaCount(value);
      return {
        elastic: {
          ...elastic,
          maxReplicas: Math.max(minReplicas, elastic.maxReplicas),
          minReplicas,
        },
        fixed: current.fixed,
        type: "elastic",
      };
    });
  };

  const handleElasticMaxReplicasChange = (value: number) => {
    setDraftReplicaStrategy((current) => {
      const elastic = normalizeElasticReplicaSettings(
        elasticSettingsFromStrategy(current)
      );
      const maxReplicas = normalizeReplicaCount(value);
      return {
        elastic: {
          ...elastic,
          maxReplicas,
          minReplicas: Math.min(elastic.minReplicas, maxReplicas),
        },
        fixed: current.fixed,
        type: "elastic",
      };
    });
  };

  const handleElasticCpuTargetChange = (value: number) => {
    setDraftReplicaStrategy((current) => {
      const elastic = normalizeElasticReplicaSettings(
        elasticSettingsFromStrategy(current)
      );
      return {
        elastic: {
          ...elastic,
          target: cpuElasticTarget(value),
        },
        fixed: current.fixed,
        type: "elastic",
      };
    });
  };

  const handleElasticMemoryTargetChange = (value: number) => {
    setDraftReplicaStrategy((current) => {
      const elastic = normalizeElasticReplicaSettings(
        elasticSettingsFromStrategy(current)
      );
      return {
        elastic: {
          ...elastic,
          target: memoryElasticTarget(memoryAverageMibToValue(value)),
        },
        fixed: current.fixed,
        type: "elastic",
      };
    });
  };

  const handleElasticTargetMetricChange = (metric: ElasticTargetMetric) => {
    setDraftReplicaStrategy((current) => {
      const elastic = normalizeElasticReplicaSettings(
        elasticSettingsFromStrategy(current)
      );
      if (metric === elastic.target.metric) {
        return { elastic, fixed: current.fixed, type: "elastic" };
      }
      return {
        elastic: {
          ...elastic,
          target: defaultElasticTargetForMetric(metric),
        },
        fixed: current.fixed,
        type: "elastic",
      };
    });
  };

  const replicaStrategyType = draftReplicaStrategy.type;

  const {
    value: cpuValueRaw,
    onValueChange: onCpuQuotaChange,
    ...cpuSliderRest
  } = cpuSlider;
  const {
    value: memoryValueRaw,
    onValueChange: onMemoryQuotaChange,
    ...memorySliderRest
  } = memorySlider;

  const cpuDecimals = 2;
  const cpuValue = clampScale(cpuValueRaw, cpuSlider.min, cpuSlider.max);
  const memoryValue = clampScale(
    memoryValueRaw,
    memorySlider.min,
    memorySlider.max
  );
  const quotaActions =
    quotaCommitMode && !settingsCommitMode && quotasDirty ? (
      <>
        <AppButton
          className="h-7 px-2 text-xs"
          disabled={quotaSavePending}
          onClick={handleQuotaCancel}
          type="button"
          variant="quiet"
        >
          Cancel
        </AppButton>
        <AppButton
          className="h-7 px-2 text-xs"
          disabled={quotaSavePending}
          onClick={async () => {
            await handleQuotaSave();
          }}
          type="button"
          variant="secondary"
        >
          Save
        </AppButton>
      </>
    ) : null;

  const handleImageChange = (nextImage: string) => {
    if (settingsCommitMode) {
      setDraftImage(nextImage);
    } else {
      onImageChange(nextImage);
      setDraftImage(nextImage);
    }
  };

  const handleImageBlur = () => {
    const nextImage = draftImage.trim();
    if (nextImage === draftImage) {
      return;
    }
    if (settingsCommitMode) {
      setDraftImage(nextImage);
    } else {
      onImageChange(nextImage);
      setDraftImage(nextImage);
    }
  };

  const handleSaveEnvRows = () => {
    if (!canSaveEnv) {
      return;
    }
    const result = normalizeContainerEnvTokenRowsForSave(
      envDraft,
      dbDsnReferenceSources
    );
    if (!result.valid) {
      return;
    }
    const normalized = result.env;
    const confirmedAddDbDsnReferences =
      confirmedAddDbDsnReferencesFromEnvDraft(envDraft);
    onEnvChange(
      normalized,
      confirmedAddDbDsnReferences.length === 0
        ? undefined
        : { confirmedAddDbDsnReferences }
    );
    setEnvDraft(
      containerEnvRowsFromSavedEnv(normalized, dbDsnReferenceSources).map(
        (row, index) => {
          const intentId = envDraft[index]?.canvasAddDbDsnReferenceIntentId;
          return intentId == null
            ? row
            : { ...row, canvasAddDbDsnReferenceIntentId: intentId };
        }
      )
    );
  };

  const handleCancelEnvRows = () => {
    const nextEnv = containerEnvRowsFromSavedEnv(env, dbDsnReferenceSources);
    setEnvDraft(nextEnv);
    setEnvDraftKeys(
      createEnvDraftKeys(nextEnv.length, envDraftKeyPrefix, envDraftKeyCounter)
    );
  };

  const handleAddEnvRow = () => {
    setEnvDraft((rows) => addContainerEnvRow(rows));
    setEnvDraftKeys((keys) => [
      ...keys,
      nextEnvDraftKey(envDraftKeyPrefix, envDraftKeyCounter),
    ]);
  };

  const handleDeleteEnvRow = (index: number) => {
    setEnvDraft((rows) => {
      const result = deleteContainerEnvTokenRow(rows, index);
      if (result.diagnostic != null) {
        return [...rows];
      }
      const refreshed = refreshContainerEnvTokenDraft(
        result.rows,
        dbDsnReferenceSources
      ).rows;
      setEnvDraftKeys((keys) =>
        resizeEnvDraftKeys(
          keys.filter((_, keyIndex) => keyIndex !== index),
          refreshed.length,
          envDraftKeyPrefix,
          envDraftKeyCounter
        )
      );
      return refreshed;
    });
  };

  const handleUpdateEnvRow = (
    index: number,
    patch: Partial<ContainerEnvRow>
  ) => {
    setEnvDraft((rows) => {
      const nextRows = updateContainerEnvTokenRow(rows, index, patch);
      const refreshed = refreshContainerEnvTokenDraft(
        nextRows,
        dbDsnReferenceSources
      ).rows;
      setEnvDraftKeys((keys) =>
        resizeEnvDraftKeys(
          keys,
          refreshed.length,
          envDraftKeyPrefix,
          envDraftKeyCounter
        )
      );
      return refreshed;
    });
  };

  const resetSettingsDraft = useCallback(() => {
    applySettingsDraftToLocalState(settingsBaseDraft);
    setSettingsBackingState((current) => ({
      ...current,
      saveFailureMessage: null,
    }));
  }, [applySettingsDraftToLocalState, settingsBaseDraft]);
  const reloadSettingsDraft = useCallback(() => {
    applySettingsDraftBackingResult(
      reloadSettingsDraftBackingState(settingsBackingState),
      {
        draft: applySettingsDraftToLocalState,
        state: setSettingsBackingState,
      }
    );
  }, [applySettingsDraftToLocalState, settingsBackingState]);

  const keepEditingSettingsDraft = useCallback(() => {
    setSettingsBackingState((current) =>
      keepEditingSettingsDraftBackingState(current)
    );
  }, []);

  const saveSettingsDraft = useCallback(async () => {
    if (!canSaveSettings || onSettingsDraftCommit == null) {
      throw new Error("Settings draft cannot be saved yet.");
    }
    const result = normalizeContainerEnvTokenRowsForSave(
      envDraft,
      dbDsnReferenceSources
    );
    if (!result.valid) {
      throw new Error(result.diagnostics[0]?.message ?? "Invalid environment.");
    }
    const normalizedEnv = result.env;
    const confirmedAddDbDsnReferences =
      confirmedAddDbDsnReferencesFromEnvDraft(envDraft);
    const draft: ContainerSettingsDraft = {
      ...settingsDraft,
      env: normalizedEnv,
      image: settingsDraft.image.trim(),
    };
    const meta: ContainerSettingsPaneSettingsDraftCommitMeta = {
      baseDraft: settingsBaseDraft,
      ...(confirmedAddDbDsnReferences.length === 0
        ? {}
        : { confirmedAddDbDsnReferences }),
    };
    setSettingsSavePending(true);
    setSettingsBackingState((current) => ({
      ...current,
      saveFailureMessage: null,
    }));
    try {
      await onSettingsDraftCommit(draft, meta);
      setSettingsBackingState((current) =>
        commitSettingsDraftBackingState(current, draft)
      );
      setEnvDraft(
        containerEnvRowsFromSavedEnv(normalizedEnv, dbDsnReferenceSources).map(
          (row, index) => {
            const intentId = envDraft[index]?.canvasAddDbDsnReferenceIntentId;
            return intentId == null
              ? row
              : { ...row, canvasAddDbDsnReferenceIntentId: intentId };
          }
        )
      );
    } catch (error) {
      setSettingsBackingState((current) =>
        failSettingsDraftSave(current, error, "Could not save settings.")
      );
      throw error;
    } finally {
      setSettingsSavePending(false);
    }
  }, [
    canSaveSettings,
    dbDsnReferenceSources,
    envDraft,
    onSettingsDraftCommit,
    settingsBaseDraft,
    settingsDraft,
  ]);

  const handleSaveSettingsDraft = useCallback(async () => {
    try {
      await saveSettingsDraft();
    } catch {
      // The footer keeps the user on the draft and shows the panel-level failure.
    }
  }, [saveSettingsDraft]);

  useEffect(() => {
    if (!settingsCommitMode || onSettingsDraftLeaveGuardChange == null) {
      return;
    }

    onSettingsDraftLeaveGuardChange(
      panelDraftDirty
        ? {
            canSave: canSaveSettings,
            dirty: true,
            discard: resetSettingsDraft,
            save: saveSettingsDraft,
            scope: "ap",
          }
        : null
    );

    return () => {
      onSettingsDraftLeaveGuardChange(null);
    };
  }, [
    canSaveSettings,
    onSettingsDraftLeaveGuardChange,
    panelDraftDirty,
    resetSettingsDraft,
    saveSettingsDraft,
    settingsCommitMode,
  ]);

  const displayImage = draftImage;
  const networkForRender = settingsCommitMode ? activeDraftNetwork : network;
  const environmentFocus = sectionFocus === "environment";
  const envSectionActions = readOnly ? null : (
    <AppButton
      aria-label="Add environment variable"
      className="h-8 rounded-lg bg-white/5 px-3 text-primary text-sm hover:bg-input"
      onClick={handleAddEnvRow}
      type="button"
      variant="quiet"
    >
      <Plus aria-hidden data-icon="inline-start" />
      Add
    </AppButton>
  );

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-5 text-muted-foreground",
        className
      )}
      data-slot="container-settings-pane"
    >
      {environmentFocus ? null : (
        <div className="grid gap-5">
          {replicasSliderParts == null ? null : (
            <ReplicaStrategySection
              actions={quotaActions}
              elastic={normalizeElasticReplicaSettings(
                elasticSettingsFromStrategy(draftReplicaStrategy)
              )}
              fixedReplicasSliderParts={replicasSliderParts}
              onElasticCpuTargetChange={handleElasticCpuTargetChange}
              onElasticMaxReplicasChange={handleElasticMaxReplicasChange}
              onElasticMemoryTargetChange={handleElasticMemoryTargetChange}
              onElasticMinReplicasChange={handleElasticMinReplicasChange}
              onElasticTargetMetricChange={handleElasticTargetMetricChange}
              onStrategyTypeChange={handleReplicaStrategyTypeChange}
              readOnly={readOnly}
              strategyType={replicaStrategyType}
            />
          )}

          <ResourceSettingsSection
            actions={replicasSliderParts == null ? quotaActions : undefined}
            title="CPU / Memory"
          >
            <ResourceSettingsInset>
              <SettingsSlider
                ariaLabel="CPU quota (cores)"
                disabled={cpuSliderRest.disabled}
                formatBound={(next) => formatPlainNumber(next, 2)}
                icon={Cpu}
                label="CPU"
                max={cpuSlider.max}
                maxDecimals={cpuDecimals}
                min={cpuSlider.min}
                onValueChange={onCpuQuotaChange}
                step={cpuSliderRest.step}
                value={cpuValue}
                valueSuffix={cpuCoresValueSuffix}
              />
            </ResourceSettingsInset>

            <ResourceSettingsInset>
              <SettingsSlider
                ariaLabel="Memory quota (MiB)"
                disabled={memorySliderRest.disabled}
                displayValue={memoryMibDisplayValue(memoryValue)}
                formatBound={formatMemoryMibValue}
                icon={MemoryStick}
                label="Memory"
                max={memorySlider.max}
                maxDecimals={2}
                min={memorySlider.min}
                onValueChange={onMemoryQuotaChange}
                step={memorySliderRest.step}
                value={memoryValue}
                valueSuffix={memoryMibValueSuffix(memoryValue)}
              />
            </ResourceSettingsInset>
          </ResourceSettingsSection>

          {showImageSection ? (
            <ImageSettingsSection
              imageInputId={imageInputId}
              onBlur={handleImageBlur}
              onChange={handleImageChange}
              readOnly={readOnly}
              value={displayImage}
            />
          ) : null}
        </div>
      )}

      <ResourceSettingsSection
        actions={envSectionActions}
        icon={SquarePen}
        title="Environment Variables"
      >
        <div className="flex min-w-0 flex-col gap-2">
          {readOnly ? (
            <ReadOnlyEnvRows env={env} />
          ) : (
            <EditableEnvRows
              dbDsnReferenceSources={dbDsnReferenceSources}
              envDirty={envDirty}
              envDraft={envDraft}
              envErrorsByIndex={envErrorsByIndex}
              envRowKeys={envDraftKeys}
              envTokenDiagnostics={envTokenDiagnostics}
              envValidation={envValidation}
              onDeleteRow={handleDeleteEnvRow}
              onUpdateRow={handleUpdateEnvRow}
              rows={envDraft}
            />
          )}
        </div>
        {readOnly || settingsCommitMode || !envDirty ? null : (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            <AppButton
              aria-label="Cancel environment changes"
              className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
              onClick={handleCancelEnvRows}
              size="lg"
              type="button"
              variant="quiet"
            >
              <X aria-hidden data-icon="inline-start" />
              Cancel
            </AppButton>
            <AppButton
              className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
              disabled={!canSaveEnv}
              onClick={handleSaveEnvRows}
              size="lg"
              type="button"
              variant="quiet"
            >
              <Save aria-hidden data-icon="inline-start" />
              Save environment
            </AppButton>
          </div>
        )}
      </ResourceSettingsSection>

      {environmentFocus || networkForRender == null ? null : (
        <NetworkSettingsSection
          network={networkForRender}
          onCustomDomainCnameVerify={onCustomDomainCnameVerify}
          onNetworkChange={settingsCommitMode ? undefined : onNetworkChange}
          onNetworkDraftChange={
            settingsCommitMode ? setDraftNetwork : undefined
          }
          platformAddressDraftContext={networkPlatformAddressDraftContext}
          readOnly={readOnly}
        />
      )}

      {settingsCommitMode ? (
        <ContainerSettingsDraftFooter
          backingResourceChanged={settingsBackingState.resourceChanged}
          canSave={canSaveSettings}
          dirty={panelDraftDirty}
          discardAriaLabel="Discard AP Settings changes"
          onCancel={resetSettingsDraft}
          onKeepEditing={keepEditingSettingsDraft}
          onReload={reloadSettingsDraft}
          onSave={handleSaveSettingsDraft}
          pending={settingsSavePending}
          saveFailureMessage={settingsBackingState.saveFailureMessage}
          submitAriaLabel={
            environmentFocus
              ? "Update Environment Variables"
              : "Update AP Settings"
          }
          submitLabel="Update"
        />
      ) : null}
    </div>
  );
}
