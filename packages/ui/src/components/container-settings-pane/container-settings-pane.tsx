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
import { SettingsSlider } from "@workspace/ui/components/settings-slider/settings-slider";
import { clampScale } from "@workspace/ui/components/settings-slider/settings-slider.utils";
import {
  SingleSelect,
  type SingleSelectOption,
} from "@workspace/ui/components/single-select";
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
  addContainerEnvDbDsnReferenceRow,
  addContainerEnvRow,
  type ContainerEnvDbDsnFieldOption,
  type ContainerEnvDbDsnReferenceTarget,
  type ContainerEnvDbDsnSource,
  type ContainerEnvDbReferenceField,
  type ContainerEnvRow,
  containerEnvDbDsnFieldOptions,
  containerEnvDbReferenceRowPatch,
  containerEnvRowsEqual,
  containerEnvRowsModelEqual,
  deleteContainerEnvRow,
  normalizeContainerEnvRowsForSave,
  updateContainerEnvRow,
  validateContainerEnvRows,
} from "@workspace/ui/lib/container-env-rows";
import {
  generateCustomDomainBindingId,
  generatePlatformAddressDomainPrefix,
  generatePlatformAddressId,
  platformAddressEndpoint,
} from "@workspace/ui/lib/platform-address";
import { parsePortNumberDigits } from "@workspace/ui/lib/port-number";
import { cn } from "@workspace/ui/lib/utils";
import {
  ChevronsDown,
  ChevronsUp,
  Copy,
  Cpu,
  MemoryStick,
  Network,
  Plus,
  Save,
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
  routing?: ContainerNetworkCustomDomainDetail;
  status?: string;
  targetPort?: number;
}

export interface ContainerNetwork {
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
   * One-shot request from a Canvas Connecting Edge to append an Add Reference row
   * with the dragged DB preselected.
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
  onCustomDomainCnameVerify?: ContainerCustomDomainCnameVerifier;
  onEnvChange: (
    env: ContainerEnvVar[],
    meta?: ContainerSettingsPaneEnvChangeMeta
  ) => void;
  onImageChange: (image: string) => void;
  onNetworkChange?: (network: ContainerNetwork) => void | Promise<void>;
  /**
   * When set (and not `readOnly`), CPU/memory/replicas sliders keep local drafts until Save; Cancel reverts.
   * Omit for live slider updates via `cpuQuota` / `memoryQuota` / `replicasQuota` `onValueChange`.
   * When `replicasQuota` is set, the draft `replicaStrategy` is included on Save.
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

function networkWithDraftPrivatePort(
  network: ContainerNetwork | undefined,
  parsedPrivatePort: ReturnType<typeof parsePortNumberDigits> | null
): ContainerNetwork | undefined {
  if (network == null) {
    return undefined;
  }
  return {
    ...network,
    privatePort: parsedPrivatePort?.ok
      ? parsedPrivatePort.n
      : network.privatePort,
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
  return `${source.namespace}/${source.name}`;
}

function dbDsnRowKey(row: ContainerEnvRow): string {
  if (row.dbDsn == null) {
    return "";
  }
  return `${row.dbDsn.dbNamespace}/${row.dbDsn.dbName}`;
}

function sourceFromDbDsnRow(
  row: ContainerEnvRow,
  sources: readonly ContainerEnvDbDsnSource[]
): ContainerEnvDbDsnSource | undefined {
  const key = dbDsnRowKey(row);
  return sources.find((source) => dbDsnSourceKey(source) === key);
}

function dbDsnSourceHasFields(source: ContainerEnvDbDsnSource): boolean {
  return containerEnvDbDsnFieldOptions(source).length > 0;
}

function dbDsnSourceLabel(source: ContainerEnvDbDsnSource): string {
  if (dbDsnSourceHasFields(source)) {
    return source.name;
  }
  return `${source.name} (unavailable)`;
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
  return sources.find(
    (source) =>
      dbDsnSourceMatchesTarget(source, target) && dbDsnSourceHasFields(source)
  );
}

function appendDbDsnReferenceIntentRow(
  rows: readonly ContainerEnvVar[],
  source: ContainerEnvDbDsnSource,
  intent: ContainerSettingsPaneAddDbDsnReferenceIntent
): EnvDraftRow[] {
  const target = addDbDsnReferenceIntentTarget(intent);
  const nextRows = addContainerEnvDbDsnReferenceRow(rows, [source], target);
  if (nextRows.length <= rows.length) {
    return [...nextRows];
  }
  return nextRows.map((row, index) =>
    index === nextRows.length - 1
      ? { ...row, canvasAddDbDsnReferenceIntentId: intent.id }
      : row
  );
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
    if (intentId == null || intentId === "" || row.dbDsn == null) {
      continue;
    }
    byIntentId.set(intentId, {
      dbName: row.dbDsn.dbName,
      dbNamespace: row.dbDsn.dbNamespace,
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
  envValidation: ReturnType<typeof validateContainerEnvRows>;
  onDeleteRow: (index: number) => void;
  onUpdateRow: (index: number, patch: Partial<ContainerEnvRow>) => void;
}

interface EditableEnvValueControlProps {
  dbDsnReferenceSources: ContainerEnvDbDsnSource[];
  index: number;
  onUpdateRow: (index: number, patch: Partial<ContainerEnvRow>) => void;
  row: ContainerEnvVar;
}

function EditableEnvValueControl({
  dbDsnReferenceSources,
  index,
  onUpdateRow,
  row,
}: EditableEnvValueControlProps) {
  if (row.valueSource === "valueFrom") {
    return (
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-foreground text-sm leading-5">
        <span className="min-w-0 truncate">External reference</span>
        <ExternalEnvBadge className="shrink-0" />
      </div>
    );
  }

  if (row.valueSource === "dbDsn" && row.dbDsn != null) {
    const selectedSource = sourceFromDbDsnRow(row, dbDsnReferenceSources);
    const selectedFields = containerEnvDbDsnFieldOptions(selectedSource);
    const sourceOptions: SingleSelectOption[] = dbDsnReferenceSources.map(
      (source) => ({
        disabled: !dbDsnSourceHasFields(source),
        label: dbDsnSourceLabel(source),
        value: dbDsnSourceKey(source),
      })
    );
    const fieldOptions: SingleSelectOption[] = selectedFields.map((field) => ({
      label: field.label,
      value: field.field,
    }));
    const updateReference = (
      source: ContainerEnvDbDsnSource | undefined,
      field: ContainerEnvDbDsnFieldOption | undefined
    ) => {
      if (source === undefined || field === undefined) {
        return;
      }
      onUpdateRow(index, containerEnvDbReferenceRowPatch(source, field));
    };

    return (
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] gap-2">
        <SingleSelect
          aria-label="Project DB"
          onValueChange={(value) => {
            const source = dbDsnReferenceSources.find(
              (item) => dbDsnSourceKey(item) === value
            );
            updateReference(source, containerEnvDbDsnFieldOptions(source)[0]);
          }}
          options={sourceOptions}
          value={dbDsnRowKey(row)}
        />
        <SingleSelect
          aria-label="Project DB field"
          disabled={selectedFields.length === 0}
          emptyMessage="No fields available"
          onValueChange={(value) => {
            const field = selectedFields.find((item) => item.field === value);
            updateReference(selectedSource, field);
          }}
          options={fieldOptions}
          value={row.dbDsn.field}
        />
      </div>
    );
  }

  return (
    <AppInput
      aria-label="Environment variable value"
      onChange={(event) =>
        onUpdateRow(index, {
          value: event.target.value,
          valueSource: "direct",
        })
      }
      placeholder="Value"
      value={row.value}
    />
  );
}

function EditableEnvRows({
  dbDsnReferenceSources,
  envDirty,
  envDraft,
  envErrorsByIndex,
  envRowKeys,
  envValidation,
  onDeleteRow,
  onUpdateRow,
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
          const rowKey = envRowKeys[index] ?? envRowKey(row, index);
          return (
            <div className="grid min-w-0 gap-1.5" key={rowKey}>
              <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <AppInput
                  aria-invalid={error != null}
                  aria-label="Environment variable name"
                  onChange={(event) =>
                    onUpdateRow(index, {
                      name: event.target.value,
                    })
                  }
                  placeholder="Name"
                  value={row.name}
                />
                <EditableEnvValueControl
                  dbDsnReferenceSources={dbDsnReferenceSources}
                  index={index}
                  onUpdateRow={onUpdateRow}
                  row={row}
                />
                <AppButton
                  aria-label="Remove environment variable"
                  className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
                  onClick={() => onDeleteRow(index)}
                  size="lg"
                  type="button"
                  variant="quiet"
                >
                  <Trash2 aria-hidden data-icon="inline-start" />
                  Delete
                </AppButton>
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
    </div>
  );
}

interface NetworkSettingsSectionProps {
  network: ContainerNetwork;
  onCustomDomainCnameVerify?: ContainerCustomDomainCnameVerifier;
  onNetworkChange?: (network: ContainerNetwork) => void | Promise<void>;
  onNetworkDraftChange?: (network: ContainerNetwork) => void;
  onPrivatePortDraftChange?: (value: string) => void;
  platformAddressDraftContext?: ContainerNetworkPlatformAddressDraftContext;
  privatePortDraft?: string;
  readOnly: boolean;
}

const PUBLIC_ADDRESS_VISIBLE_COUNT = 2;

function hasNetworkPanelDraftControls({
  onNetworkDraftChange,
  onPrivatePortDraftChange,
}: Pick<
  NetworkSettingsSectionProps,
  "onNetworkDraftChange" | "onPrivatePortDraftChange"
>): boolean {
  return onNetworkDraftChange != null || onPrivatePortDraftChange != null;
}

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
  return address.status?.trim() || "Pending";
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
  return domain.status?.trim() || "Pending";
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
      {({ copied, copyable: rowCopyable }) => (
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
              <CanvasNode.CopyableRowIndicator
                className={cn(
                  "text-muted-foreground",
                  copied && "text-green-500"
                )}
              />
            </div>
            <div className="min-w-0 truncate text-muted-foreground text-sm leading-5">
              {address.port}
            </div>
          </div>
          <CanvasNode.CopyableRowControl className="relative z-20 flex shrink-0 items-center gap-2">
            {readOnly || onBindCustomDomain == null ? null : (
              <AppButton
                aria-label="Bind Custom Domain"
                className="h-9 min-w-20 rounded-lg bg-white/5 px-4 text-foreground text-sm hover:bg-input"
                disabled={value === ""}
                onClick={onBindCustomDomain}
                size="lg"
                type="button"
                variant="quiet"
              >
                CNAME
              </AppButton>
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

interface CnameBindingDialogProps {
  address: ContainerNetworkPublicAddress | undefined;
  onBind: (domain: ContainerNetworkCustomDomain) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  verify?: ContainerCustomDomainCnameVerifier;
}

function CnameBindingDialog({
  address,
  onBind,
  onOpenChange,
  open,
  verify,
}: CnameBindingDialogProps) {
  const inputId = useId();
  const target = publicAddressHostValue(address);
  const platformAddressId = address?.id?.trim() ?? "";
  const [domainDraft, setDomainDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDomainDraft("");
      setError(null);
      setPending(false);
    }
  }, [open]);

  const handleVerify = async () => {
    const domain = normalizeCustomDomainDraft(domainDraft);
    if (domain === "") {
      setError("Custom Domain is required.");
      return;
    }
    if (target === "" || platformAddressId === "") {
      setError("Platform Address host is not ready.");
      return;
    }
    if (verify == null) {
      setError("CNAME verification is unavailable.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const result = await verify({ domain, target });
      if (!result.ok) {
        setError(result.message ?? "CNAME verification failed.");
        return;
      }
      onBind({
        cnameTarget: target,
        domain,
        id: generateCustomDomainBindingId(),
        platformAddressId,
        status: "verified",
        targetPort: address?.port,
      });
      onOpenChange(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "CNAME verification failed."
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AppDialog.Root
      onOpenChange={(nextOpen) => {
        if (pending && !nextOpen) {
          return;
        }
        onOpenChange(nextOpen);
      }}
      open={open}
    >
      <AppDialog.Content>
        <AppDialog.Header>
          <AppDialog.Title>Bind Custom Domain</AppDialog.Title>
        </AppDialog.Header>
        <AppDialog.Body>
          <AppDialog.Description>
            Configure a CNAME record pointing to this Platform Address.
          </AppDialog.Description>
          <AppDialog.Field>
            <AppDialog.Label>CNAME target</AppDialog.Label>
            <div className="min-w-0 truncate rounded-md border border-white/10 bg-white/5 px-2.5 py-2 font-mono text-sm text-zinc-100">
              {target === "" ? "Pending domain" : target}
            </div>
          </AppDialog.Field>
          <AppInputField
            disabled={pending}
            error={error}
            id={inputId}
            label="Custom Domain"
            onChange={(event) => {
              setDomainDraft(event.target.value);
              setError(null);
            }}
            placeholder="www.example.com"
            value={domainDraft}
          />
        </AppDialog.Body>
        <AppDialog.Footer>
          <AppDialog.Cancel disabled={pending}>Cancel</AppDialog.Cancel>
          <AppDialog.Action
            loading={pending}
            loadingLabel="Verifying"
            onClick={handleVerify}
            type="button"
          >
            Verify
          </AppDialog.Action>
        </AppDialog.Footer>
      </AppDialog.Content>
    </AppDialog.Root>
  );
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

interface NetworkSectionActionsProps {
  canSave: boolean;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
  pending: boolean;
}

function NetworkSectionActions({
  canSave,
  onCancel,
  onSave,
  pending,
}: NetworkSectionActionsProps) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <AppButton
        className="h-7 px-2 text-xs"
        disabled={pending}
        onClick={onCancel}
        type="button"
        variant="quiet"
      >
        Cancel
      </AppButton>
      <AppButton
        className="h-7 px-2 text-xs"
        disabled={!canSave}
        onClick={async () => {
          await onSave();
        }}
        type="button"
        variant="secondary"
      >
        Save
      </AppButton>
    </div>
  );
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
      <div className="flex min-w-0 items-center justify-between gap-3">
        <p className="min-w-0 text-foreground text-xs leading-4">
          Auto-generated subdomain. Set port and CNAME.
        </p>
        <div className="flex shrink-0 gap-2">
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
  return {
    ...network,
    customDomains:
      draft.customDomain == null
        ? network.customDomains
        : [...(network.customDomains ?? []), draft.customDomain],
    publicAddresses: [...network.publicAddresses, draft.publicAddress],
  };
}

interface DomainListSectionProps {
  addOpen: boolean;
  canMutateNetwork: boolean;
  defaultPort: number;
  onAddPublicAddress: (
    address: PublicAddressDraft,
    customDomain?: ContainerNetworkCustomDomain
  ) => void | Promise<void>;
  onBindAddress: (address: ContainerNetworkPublicAddress) => void;
  onCancelAddPublicAddress: () => void;
  onCollapsePublicAddresses: () => void;
  onDeletePublicAddress: (index: number) => void | Promise<void>;
  onOpenAddPublicAddress: () => void;
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
  onAddPublicAddress,
  onBindAddress,
  onCancelAddPublicAddress,
  onCollapsePublicAddresses,
  onDeletePublicAddress,
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
  const VisibilityIcon = showAllPublicAddresses ? ChevronsUp : ChevronsDown;

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
              return (
                <PublicAddressRow
                  address={address}
                  key={key}
                  onBindCustomDomain={
                    canMutateNetwork ? () => onBindAddress(address) : undefined
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
              ? "Collapse Public Addresses"
              : "View All Public Addresses"
          }
          className="group inline-flex h-5 shrink-0 select-none items-center justify-center gap-1.5 justify-self-center whitespace-nowrap rounded-lg border border-transparent bg-transparent bg-clip-padding px-2 font-medium text-muted-foreground text-xs leading-5 outline-none transition-colors hover:bg-input/30 hover:text-foreground focus-visible:border-ring focus-visible:bg-input/30 focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
          onClick={
            showAllPublicAddresses
              ? onCollapsePublicAddresses
              : onShowAllPublicAddresses
          }
          type="button"
        >
          {showAllPublicAddresses ? "Collapse" : "View All"}
          <VisibilityIcon
            aria-hidden
            className={cn(
              "size-3.5 transition-opacity",
              showAllPublicAddresses
                ? "opacity-100"
                : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            )}
            data-icon="inline-end"
            strokeWidth={2}
          />
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
  onPrivatePortDraftChange,
  privatePortDraft,
  readOnly,
}: NetworkSettingsSectionProps) {
  const networkInputId = useId();
  const [draftPort, setDraftPort] = useState(() => String(network.privatePort));
  const [addOpen, setAddOpen] = useState(false);
  const [portError, setPortError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [showAllPublicAddresses, setShowAllPublicAddresses] = useState(false);
  const [cnameAddress, setCnameAddress] = useState<
    ContainerNetworkPublicAddress | undefined
  >(undefined);
  const portDraft = privatePortDraft ?? draftPort;
  const privateAddress = network.privateAddress ?? "";
  const hasPrivateAddress = privateAddress !== "";
  const visibleDomains = visibleDomainRows(network);
  const usesPanelDraft = hasNetworkPanelDraftControls({
    onNetworkDraftChange,
    onPrivatePortDraftChange,
  });
  const canMutateNetwork = canMutateNetworkDraft({
    onNetworkChange,
    onNetworkDraftChange,
    readOnly,
  });
  const visiblePublicAddresses = showAllPublicAddresses
    ? visibleDomains.publicAddresses
    : visibleDomains.publicAddresses.slice(0, PUBLIC_ADDRESS_VISIBLE_COUNT);

  useEffect(() => {
    if (privatePortDraft == null) {
      setDraftPort(String(network.privatePort));
    }
    setPortError(null);
  }, [network.privatePort, privatePortDraft]);

  useEffect(() => {
    if (visibleDomains.publicAddresses.length <= PUBLIC_ADDRESS_VISIBLE_COUNT) {
      setShowAllPublicAddresses(false);
    }
  }, [visibleDomains.publicAddresses.length]);

  const parsedPort = parsePortNumberDigits(portDraft.trim());
  const effectivePortError =
    usesPanelDraft && !parsedPort.ok ? parsedPort.message : portError;
  const portDirty = portDraft.trim() !== String(network.privatePort);
  const canSave =
    !usesPanelDraft &&
    onNetworkChange != null &&
    portDirty &&
    parsedPort.ok &&
    !savePending;

  const handleCancel = () => {
    if (onPrivatePortDraftChange == null) {
      setDraftPort(String(network.privatePort));
    } else {
      onPrivatePortDraftChange(String(network.privatePort));
    }
    setPortError(null);
  };

  const handleSave = async () => {
    if (onNetworkChange == null) {
      return;
    }
    const parsed = parsePortNumberDigits(portDraft.trim());
    if (!parsed.ok) {
      setPortError(parsed.message);
      return;
    }
    setSavePending(true);
    try {
      await onNetworkChange({ ...network, privatePort: parsed.n });
    } finally {
      setSavePending(false);
    }
  };

  const handleCopyPrivateAddress = async () => {
    if (!hasPrivateAddress) {
      return;
    }
    await navigator.clipboard?.writeText(privateAddress);
  };

  const handleCancelAddPublicAddress = () => {
    setAddOpen(false);
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

  const handleBindCustomDomain = async (
    domain: ContainerNetworkCustomDomain
  ) => {
    await commitNetworkChange(
      {
        ...network,
        customDomains: [...(network.customDomains ?? []), domain],
      },
      { onNetworkChange, onNetworkDraftChange }
    );
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
      <NetworkCard
        actions={
          readOnly || usesPanelDraft || !portDirty ? null : (
            <NetworkSectionActions
              canSave={canSave}
              onCancel={handleCancel}
              onSave={handleSave}
              pending={savePending}
            />
          )
        }
        title="Private Address"
      >
        <button
          aria-label="Copy Private Address"
          className="group flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md bg-white/5 px-2.5 py-2 text-left transition-colors hover:bg-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default disabled:hover:bg-white/5"
          disabled={!hasPrivateAddress}
          onClick={handleCopyPrivateAddress}
          title="Copy Private Address"
          type="button"
        >
          <div className="min-w-0 flex-1 truncate font-mono text-foreground text-sm leading-5">
            {hasPrivateAddress ? privateAddress : "Pending"}
          </div>
          <Copy
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        </button>

        <AppInputField
          disabled={readOnly}
          error={effectivePortError}
          id={networkInputId}
          inputClassName="max-w-32"
          inputMode="numeric"
          label="Private Address target port"
          onChange={(event) => {
            if (onPrivatePortDraftChange == null) {
              setDraftPort(event.target.value);
            } else {
              onPrivatePortDraftChange(event.target.value);
            }
            setPortError(null);
          }}
          value={portDraft}
        />
      </NetworkCard>

      <DomainListSection
        addOpen={addOpen}
        canMutateNetwork={canMutateNetwork}
        defaultPort={parsedPort.ok ? parsedPort.n : network.privatePort}
        onAddPublicAddress={handleAddPublicAddress}
        onBindAddress={setCnameAddress}
        onCancelAddPublicAddress={handleCancelAddPublicAddress}
        onCollapsePublicAddresses={() => setShowAllPublicAddresses(false)}
        onDeletePublicAddress={handleDeletePublicAddress}
        onOpenAddPublicAddress={() => setAddOpen(true)}
        onShowAllPublicAddresses={() => setShowAllPublicAddresses(true)}
        onUnbindCustomDomain={handleUnbindCustomDomain}
        platformAddressDraftContext={platformAddressDraftContext}
        readOnly={readOnly}
        showAllPublicAddresses={showAllPublicAddresses}
        verify={onCustomDomainCnameVerify}
        visibleDomainRows={visibleDomains}
        visiblePublicAddresses={visiblePublicAddresses}
      />
      <CnameBindingDialog
        address={cnameAddress}
        onBind={handleBindCustomDomain}
        onOpenChange={(open) => {
          if (!open) {
            setCnameAddress(undefined);
          }
        }}
        open={cnameAddress != null}
        verify={onCustomDomainCnameVerify}
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
  const [showAllPublicAddresses, setShowAllPublicAddresses] = useState(false);
  const [cnameAddress, setCnameAddress] = useState<
    ContainerNetworkPublicAddress | undefined
  >(undefined);

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
    setDraftNetwork(
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

  const handleBindCustomDomain = (domain: ContainerNetworkCustomDomain) => {
    setDraftNetwork({
      ...networkForRender,
      customDomains: [...(networkForRender.customDomains ?? []), domain],
    });
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
        onAddPublicAddress={handleAddPublicAddress}
        onBindAddress={setCnameAddress}
        onCancelAddPublicAddress={() => setAddOpen(false)}
        onCollapsePublicAddresses={() => setShowAllPublicAddresses(false)}
        onDeletePublicAddress={handleDeletePublicAddress}
        onOpenAddPublicAddress={() => setAddOpen(true)}
        onShowAllPublicAddresses={() => setShowAllPublicAddresses(true)}
        onUnbindCustomDomain={handleUnbindCustomDomain}
        platformAddressDraftContext={networkPlatformAddressDraftContext}
        readOnly={readOnly}
        showAllPublicAddresses={showAllPublicAddresses}
        verify={onCustomDomainCnameVerify}
        visibleDomainRows={visibleDomains}
        visiblePublicAddresses={visiblePublicAddresses}
      />
      <CnameBindingDialog
        address={cnameAddress}
        onBind={handleBindCustomDomain}
        onOpenChange={(open) => {
          if (!open) {
            setCnameAddress(undefined);
          }
        }}
        open={cnameAddress != null}
        verify={onCustomDomainCnameVerify}
      />
      {commitMode ? (
        <ContainerSettingsDraftFooter
          backingResourceChanged={networkBackingState.resourceChanged}
          canSave={canSave}
          dirty={networkDirty}
          onCancel={resetNetworkDraft}
          onKeepEditing={keepEditingNetworkDraft}
          onReload={reloadNetworkDraft}
          onSave={handleSaveNetworkDraft}
          pending={savePending}
          saveFailureMessage={networkBackingState.saveFailureMessage}
          submitAriaLabel="Save public addresses"
          unsavedMessage="Unsaved Public Address changes."
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
  onCancel,
  onKeepEditing,
  onReload,
  onSave,
  pending,
  saveFailureMessage,
  submitAriaLabel = "Save settings",
  unsavedMessage,
}: {
  backingResourceChanged: boolean;
  canSave: boolean;
  dirty: boolean;
  onCancel: () => void;
  onKeepEditing: () => void;
  onReload: () => void;
  onSave: () => void | Promise<void>;
  pending: boolean;
  saveFailureMessage: string | null;
  submitAriaLabel?: string;
  unsavedMessage?: string;
}) {
  return (
    <ResourceSettingsDraftFooter
      backingResourceChanged={backingResourceChanged}
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
}: ContainerSettingsPaneProps) {
  const [draftImage, setDraftImage] = useState(image);
  const [quotaSavePending, setQuotaSavePending] = useState(false);
  const [settingsSavePending, setSettingsSavePending] = useState(false);
  const [draftNetwork, setDraftNetwork] = useState<
    ContainerNetwork | undefined
  >(network);
  const [networkPrivatePortDraft, setNetworkPrivatePortDraft] = useState(() =>
    network == null ? "" : String(network.privatePort)
  );
  const imageInputId = useId();
  const envDraftKeyPrefix = useId();
  const envDraftKeyCounter = useRef(0);
  const initialEnvDraft = useMemo(
    () =>
      envDraftWithAddReferenceIntent({
        intent: addDbDsnReferenceIntent,
        readOnly,
        rows: env,
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
    setNetworkPrivatePortDraft(
      network == null ? "" : String(network.privatePort)
    );
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
    setEnvDraft(env);
    setEnvDraftKeys(
      createEnvDraftKeys(env.length, envDraftKeyPrefix, envDraftKeyCounter)
    );
  }, [env, envDraftKeyPrefix, settingsCommitMode]);

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
  const canSaveEnv = envDirty && envValidation.valid;
  const parsedNetworkPrivatePort =
    network == null
      ? null
      : parsePortNumberDigits(networkPrivatePortDraft.trim());
  const networkPrivatePortValid =
    parsedNetworkPrivatePort == null || parsedNetworkPrivatePort.ok;
  const activeDraftNetwork = settingsCommitMode
    ? draftNetwork
    : (draftNetwork ?? network);
  const settingsDraftNetwork = useMemo(
    () =>
      networkWithDraftPrivatePort(activeDraftNetwork, parsedNetworkPrivatePort),
    [activeDraftNetwork, parsedNetworkPrivatePort]
  );
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
      setEnvDraft(next.env.map((row) => ({ ...row })));
      setEnvDraftKeys(
        createEnvDraftKeys(
          next.env.length,
          envDraftKeyPrefix,
          envDraftKeyCounter
        )
      );
      syncedEnvRef.current = next.env;
      setDraftNetwork(next.network);
      setNetworkPrivatePortDraft(
        next.network == null ? "" : String(next.network.privatePort)
      );
    },
    [envDraftKeyPrefix, replicasQuota?.value]
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
  const baseNetworkPrivatePort = settingsBaseDraft.network?.privatePort;
  const networkPrivatePortDirty =
    baseNetworkPrivatePort != null &&
    networkPrivatePortDraft.trim() !== String(baseNetworkPrivatePort);
  const panelDraftDirty = settingsDirty || networkPrivatePortDirty;
  const canSaveSettings =
    settingsCommitMode &&
    panelDraftDirty &&
    envValidation.valid &&
    networkPrivatePortValid &&
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
    const normalized = normalizeContainerEnvRowsForSave(envDraft);
    const confirmedAddDbDsnReferences =
      confirmedAddDbDsnReferencesFromEnvDraft(envDraft);
    onEnvChange(
      normalized,
      confirmedAddDbDsnReferences.length === 0
        ? undefined
        : { confirmedAddDbDsnReferences }
    );
    setEnvDraft(
      normalized.map((row, index) => {
        const intentId = envDraft[index]?.canvasAddDbDsnReferenceIntentId;
        return intentId == null
          ? row
          : { ...row, canvasAddDbDsnReferenceIntentId: intentId };
      })
    );
  };

  const handleCancelEnvRows = () => {
    setEnvDraft(env);
    setEnvDraftKeys(
      createEnvDraftKeys(env.length, envDraftKeyPrefix, envDraftKeyCounter)
    );
  };

  const handleAddEnvRow = () => {
    setEnvDraft((rows) => addContainerEnvRow(rows));
    setEnvDraftKeys((keys) => [
      ...keys,
      nextEnvDraftKey(envDraftKeyPrefix, envDraftKeyCounter),
    ]);
  };

  const canAddDbDsnReference = dbDsnReferenceSources.some(dbDsnSourceHasFields);

  const handleAddDbDsnReferenceRow = () => {
    setEnvDraft((rows) =>
      addContainerEnvDbDsnReferenceRow(rows, dbDsnReferenceSources)
    );
    setEnvDraftKeys((keys) => [
      ...keys,
      nextEnvDraftKey(envDraftKeyPrefix, envDraftKeyCounter),
    ]);
  };

  const handleDeleteEnvRow = (index: number) => {
    setEnvDraft((rows) => deleteContainerEnvRow(rows, index));
    setEnvDraftKeys((keys) => keys.filter((_, keyIndex) => keyIndex !== index));
  };

  const handleUpdateEnvRow = (
    index: number,
    patch: Partial<ContainerEnvRow>
  ) => {
    setEnvDraft((rows) => updateContainerEnvRow(rows, index, patch));
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
    const normalizedEnv = normalizeContainerEnvRowsForSave(envDraft);
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
        normalizedEnv.map((row, index) => {
          const intentId = envDraft[index]?.canvasAddDbDsnReferenceIntentId;
          return intentId == null
            ? row
            : { ...row, canvasAddDbDsnReferenceIntentId: intentId };
        })
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

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-5 text-muted-foreground",
        className
      )}
      data-slot="container-settings-pane"
    >
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

        <ImageSettingsSection
          imageInputId={imageInputId}
          onBlur={handleImageBlur}
          onChange={handleImageChange}
          readOnly={readOnly}
          value={displayImage}
        />
      </div>

      <ResourceSettingsSection icon={SquarePen} title="Environment Variables">
        <div className="flex min-w-0 flex-col gap-2">
          <Label className="text-foreground text-sm leading-none">
            Variables
          </Label>
          {readOnly ? (
            <ReadOnlyEnvRows env={env} />
          ) : (
            <EditableEnvRows
              dbDsnReferenceSources={dbDsnReferenceSources}
              envDirty={envDirty}
              envDraft={envDraft}
              envErrorsByIndex={envErrorsByIndex}
              envRowKeys={envDraftKeys}
              envValidation={envValidation}
              onDeleteRow={handleDeleteEnvRow}
              onUpdateRow={handleUpdateEnvRow}
            />
          )}
        </div>
        {readOnly ? null : (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
            {!settingsCommitMode && envDirty ? (
              <>
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
              </>
            ) : null}
            <AppButton
              aria-label="Add environment variable"
              className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
              onClick={handleAddEnvRow}
              size="lg"
              type="button"
              variant="quiet"
            >
              <Plus aria-hidden data-icon="inline-start" />
              Add
            </AppButton>
            {canAddDbDsnReference ? (
              <AppButton
                aria-label="Add Project DB reference"
                className="h-9 rounded-lg bg-white/5 px-4 text-primary text-sm hover:bg-input"
                onClick={handleAddDbDsnReferenceRow}
                size="lg"
                type="button"
                variant="quiet"
              >
                <Plus aria-hidden data-icon="inline-start" />
                Add Reference
              </AppButton>
            ) : null}
          </div>
        )}
      </ResourceSettingsSection>

      {networkForRender == null ? null : (
        <NetworkSettingsSection
          network={networkForRender}
          onCustomDomainCnameVerify={onCustomDomainCnameVerify}
          onNetworkChange={settingsCommitMode ? undefined : onNetworkChange}
          onNetworkDraftChange={
            settingsCommitMode ? setDraftNetwork : undefined
          }
          onPrivatePortDraftChange={
            settingsCommitMode ? setNetworkPrivatePortDraft : undefined
          }
          platformAddressDraftContext={networkPlatformAddressDraftContext}
          privatePortDraft={
            settingsCommitMode ? networkPrivatePortDraft : undefined
          }
          readOnly={readOnly}
        />
      )}

      {settingsCommitMode ? (
        <ContainerSettingsDraftFooter
          backingResourceChanged={settingsBackingState.resourceChanged}
          canSave={canSaveSettings}
          dirty={panelDraftDirty}
          onCancel={resetSettingsDraft}
          onKeepEditing={keepEditingSettingsDraft}
          onReload={reloadSettingsDraft}
          onSave={handleSaveSettingsDraft}
          pending={settingsSavePending}
          saveFailureMessage={settingsBackingState.saveFailureMessage}
        />
      ) : null}
    </div>
  );
}
