"use client";

import { AppButton } from "@workspace/ui/components/app-button";
import { CANVAS_NODE_DEFAULT_COPIED_FEEDBACK_MS } from "@workspace/ui/components/canvas-node/canvas-node.copyable-row";
import { ResourceSettingsInset } from "@workspace/ui/components/resource-settings/resource-settings";
import { SettingsSlider } from "@workspace/ui/components/settings-slider/settings-slider";
import { clampScale } from "@workspace/ui/components/settings-slider/settings-slider.utils";
import { SlidingToggle } from "@workspace/ui/components/sliding-toggle";
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Plus,
  Save,
  SquarePen,
  Terminal,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { isStorageShrink } from "@/components/storage-size";
import { toastErrorDetail } from "@/lib/toast-utils";
import {
  classifyPendingSettingsEntry,
  getBrowserPendingSettingsStore,
  type PendingSettingsOwnerIdentity,
  type PendingSettingsUpdateEntry,
} from "../pending-settings-updates";
import type {
  SettingsLeaveGuardHandle,
  SettingsLeaveGuardRegistration,
} from "../settings-leave-guard";
import {
  getBrowserSettingsSubmissionStore,
  latestRejectedSettingsSubmission,
  type SettingsSubmissionDomainUpdate,
  useSettingsSubmissionEntries,
} from "../settings-submissions";
import { useApNetworkDraftController } from "./ap-network-draft";
import type {
  ApCustomDomainCnameVerifier,
  ApNetwork,
  ApNetworkPlatformAddressDraftContext,
} from "./ap-network-model";
import {
  type ApPendingSettingsTarget,
  type ApPendingSettingsTargets,
  apPendingTargetForDomain,
  apPendingTargetsEqual,
  apPendingTargetsForDirtyDomains,
  applyApPendingTargets,
} from "./ap-pending-settings";
import {
  type ApReplicaStrategy,
  cpuCoresValueSuffix,
  cpuElasticTarget,
  DEFAULT_FIXED_REPLICAS,
  defaultElasticTargetForMetric,
  type ElasticTargetMetric,
  elasticSettingsFromStrategy,
  formatMemoryMibValue,
  formatPlainNumber,
  memoryAverageMibToValue,
  memoryElasticTarget,
  memoryMibDisplayValue,
  memoryMibValueSuffix,
  normalizeElasticReplicaSettings,
  normalizeFixedReplicaSettings,
  normalizeReplicaCount,
  normalizeReplicaStrategy,
  REPLICA_LIMITS,
  ReplicaStrategyContent,
  type ReplicaStrategyType,
  replicaStrategyWithType,
  resourceQuotaReplicaPatchFromDraft,
  resourceQuotasDirty,
} from "./ap-replica-strategy-section";
import {
  AP_SETTINGS_DRAFT_DOMAINS,
  type ApSettingsDraft,
  type ApSettingsDraftCommitMeta,
  type ApSettingsDraftDomain,
  apSettingsDraftBackingKey,
  apSettingsDraftDomainIsDirty,
  apSettingsDraftFromValues,
  apSettingsDraftIsDirty,
  createDraftRowKey,
  createDraftRowKeys,
  mergeApSettingsDraftDomains,
} from "./ap-settings-draft";
import type {
  ApPublicAddressReadiness,
  ApSettingsControlledQuotaProps,
  ApSettingsRenderedSection,
  ApSettingsSectionsModel,
} from "./ap-settings-model";
import {
  type ApEnvResolvedValueResolver,
  type ApEnvVar,
  type ApSettingsAddDbDsnReferenceIntent,
  type ApSettingsEnvChangeMeta,
  type ApSettingsPendingDbReference,
  createEnvDraftKeys,
  dbDsnSourceFromAddReferenceIntent,
  EditableEnvRows,
  ENV_EDITOR_MODE_TOGGLE_OPTIONS,
  ENV_REVEAL_DURATION_MS,
  type EnvDraftRow,
  type EnvEditorMode,
  envDraftRowsFromRawParse,
  envDraftRowsFromRawSource,
  envRawSourceDraftWithAddReferenceIntent,
  nextEnvDraftKey,
  pendingDbReferencesFromEnvRawSourceDraft,
  ReadOnlyEnvRows,
  resizeEnvDraftKeys,
  writeTextToClipboard,
} from "./environment-section";
import {
  appendApEnvRawSourceRow,
  applyApEnvRawSourceRowPatch,
  canonicalApEnvRawSource,
  compileApEnvRawSourceForRuntime,
  deleteApEnvRawSourceRow,
  parseApEnvRawSource,
} from "./lib/ap-env-raw-source";
import {
  type ApEnvDbDsnSource,
  type ApEnvRow,
  addApEnvRow,
  apEnvRowsModelEqual,
  validateApEnvRows,
} from "./lib/ap-env-rows";
import {
  applySettingsDraftBackingResult,
  commitSettingsDraftBackingState,
  createSettingsDraftBackingState,
  failSettingsDraftSave,
  keepEditingSettingsDraftBackingState,
  prepareSettingsDraftSubmit,
  reloadSettingsDraftBackingState,
  settingsDraftSaveFailureMessage,
  syncSettingsDraftBackingState,
} from "./lib/settings-draft-backing";
import { NetworkSettingsSection } from "./network-section";
import {
  type ApConfigMapMount,
  ApSettingsDraftFooter,
  type ApStorageMount,
  type ApWorkloadKind,
  ConfigMapSettingsContent,
  ImageSettingsContent,
  LaunchCommandSettingsContent,
  normalizeCommandDraftLines,
  normalizeConfigMapDraftRows,
  normalizeStorageDraftRows,
  StorageSettingsContent,
} from "./workload-sections";

const AP_SETTINGS_SUBMIT_CONFLICT_MESSAGE =
  "AP configuration changed since you started editing.";
const AP_SETTINGS_DRAFT_DOMAIN_SET = new Set<string>(AP_SETTINGS_DRAFT_DOMAINS);
const EMPTY_AP_NETWORK: ApNetwork = {
  privatePort: 80,
  publicAddresses: [],
};

function isApSettingsDraftDomain(
  domain: string
): domain is ApSettingsDraftDomain {
  return AP_SETTINGS_DRAFT_DOMAIN_SET.has(domain);
}

function apSettingsSubmissionTargets(
  entries: readonly { domain: string; status: string; target: unknown }[]
): ApPendingSettingsTargets {
  const targets: ApPendingSettingsTargets = {};
  for (const entry of entries) {
    if (
      entry.status !== "submitting" ||
      !isApSettingsDraftDomain(entry.domain)
    ) {
      continue;
    }
    targets[entry.domain] = entry.target as never;
  }
  return targets;
}

function apSettingsSubmissionUpdates(
  base: ApSettingsDraft,
  draft: ApSettingsDraft
): SettingsSubmissionDomainUpdate<ApPendingSettingsTarget>[] {
  const targets = apPendingTargetsForDirtyDomains(base, draft);
  const updates: SettingsSubmissionDomainUpdate<ApPendingSettingsTarget>[] = [];
  for (const domain of AP_SETTINGS_DRAFT_DOMAINS) {
    if (!Object.hasOwn(targets, domain)) {
      continue;
    }
    updates.push({
      domain,
      submittedAgainst: apPendingTargetForDomain(domain, base),
      target: targets[domain] as ApPendingSettingsTarget,
    });
  }
  return updates;
}

function apAcceptedPendingTargets(
  base: ApSettingsDraft,
  entries: readonly PendingSettingsUpdateEntry[]
): {
  reconciledDomains: readonly ApSettingsDraftDomain[];
  targets: ApPendingSettingsTargets;
} {
  const reconciledDomains: ApSettingsDraftDomain[] = [];
  const targets: ApPendingSettingsTargets = {};
  for (const entry of entries) {
    if (!isApSettingsDraftDomain(entry.domain)) {
      continue;
    }
    const domain = entry.domain;
    const classification = classifyPendingSettingsEntry(
      entry as PendingSettingsUpdateEntry<ApPendingSettingsTarget>,
      {
        equals: (left, right) => apPendingTargetsEqual(domain, left, right),
        observed: apPendingTargetForDomain(domain, base),
      }
    );
    if (classification.status === "reconciled") {
      reconciledDomains.push(domain);
      continue;
    }
    if (classification.status === "diverged") {
      continue;
    }
    targets[domain] = entry.target as never;
  }
  return { reconciledDomains, targets };
}

export interface ApSettingsSectionsProps {
  /**
   * One-shot request from a Canvas Connecting Edge to append an environment row
   * with the dragged DB selected as transient Reference context.
   */
  addDbDsnReferenceIntent?: ApSettingsAddDbDsnReferenceIntent | null;
  args?: readonly string[];
  className?: string;
  command?: readonly string[];
  configMaps?: readonly ApConfigMapMount[];
  cpuQuota: ApSettingsControlledQuotaProps;
  /** Project DB connection strings that can be saved into AP env values as DSN references. */
  dbDsnReferenceSources?: ApEnvDbDsnSource[];
  /** Environment variables shown and edited as structured rows. */
  env: ApEnvVar[];
  /** Canonical AP Environment Raw Source. When omitted, direct saved env rows are projected into `.env` source. */
  envRawSource?: string;
  /** Identity boundary used to clear transient resolved values when switching AP resources. */
  envResolvedValueScope?: string;
  /** Full image reference (repository + tag/digest). */
  image: string;
  memoryQuota: ApSettingsControlledQuotaProps;
  /** AP network model rendered by the Network section. */
  network?: ApNetwork;
  networkPlatformAddressDraftContext?: ApNetworkPlatformAddressDraftContext;
  onAddDbDsnReferenceIntentConsumed?: (id: string) => void;
  onCustomDomainCnameVerify?: ApCustomDomainCnameVerifier;
  onEnvChange: (env: ApEnvVar[], meta?: ApSettingsEnvChangeMeta) => void;
  /** Fetches one clean saved row's fully resolved runtime value for explicit reveal/copy actions. */
  onEnvResolvedValue?: ApEnvResolvedValueResolver;
  onImageChange: (image: string) => void;
  onNetworkChange?: (network: ApNetwork) => void | Promise<void>;
  onPendingDbReferencesChange?: (
    references: readonly ApSettingsPendingDbReference[]
  ) => void;
  /**
   * When set (and not `readOnly`), CPU/memory/replicas sliders keep local drafts until Update; Discard reverts.
   * Omit for live slider updates via `cpuQuota` / `memoryQuota` / `replicasQuota` `onValueChange`.
   * When `replicasQuota` is set, the draft `replicaStrategy` is included on Update.
   */
  onResourceQuotasCommit?: (next: {
    cpu: number;
    memory: number;
    replicaStrategy?: ApReplicaStrategy;
    replicas?: number;
  }) => void | Promise<void>;
  /** Panel-level AP Settings Draft commit. When set, all editable controls save through one draft update. */
  onSettingsDraftCommit?: (
    draft: ApSettingsDraft,
    meta?: ApSettingsDraftCommitMeta
  ) => void | Promise<void>;
  onSettingsDraftLeaveGuardChange?: SettingsLeaveGuardRegistration;
  publicAddressReadiness?: readonly ApPublicAddressReadiness[];
  /**
   * When true, image/env/network are view-only and quota sliders do not send updates.
   * Host may pass no-op callbacks.
   */
  readOnly?: boolean;
  /** AP replica behavior rendered as a mutually exclusive strategy control. */
  replicaStrategy?: ApReplicaStrategy;
  /**
   * Fixed AP replica count. Omit to hide the control (e.g. DB workloads).
   */
  replicasQuota?: ApSettingsControlledQuotaProps;
  /** Restrict the pane to one AP Settings section for focused entry points. */
  sectionFocus?: "all" | "environment";
  /** Hide the Image section when image updates belong in a separate deployment surface. */
  showImageSection?: boolean;
  storage?: readonly ApStorageMount[];
  submissionOwner?: PendingSettingsOwnerIdentity;
  workloadKind?: ApWorkloadKind;
}

function scrollFirstUnsavedSettingIntoView(selector: string) {
  if (typeof document === "undefined") {
    return;
  }
  const scroll = () =>
    document
      .querySelector(selector)
      ?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(scroll);
  } else {
    scroll();
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This provider-local assembler coordinates shared AP Settings draft, save, reveal, and leave-guard state across split sections.
export function useApSettingsSections({
  addDbDsnReferenceIntent,
  args = [],
  command = [],
  configMaps = [],
  envRawSource,
  image,
  onImageChange,
  onNetworkChange,
  onEnvChange,
  onAddDbDsnReferenceIntentConsumed,
  onPendingDbReferencesChange,
  cpuQuota,
  memoryQuota,
  env,
  network,
  networkPlatformAddressDraftContext,
  onCustomDomainCnameVerify,
  publicAddressReadiness,
  replicasQuota,
  replicaStrategy,
  envResolvedValueScope,
  onResourceQuotasCommit,
  onEnvResolvedValue,
  onSettingsDraftCommit,
  readOnly = false,
  dbDsnReferenceSources = [],
  sectionFocus = "all",
  showImageSection = true,
  storage = [],
  submissionOwner,
  workloadKind = "deployment",
}: ApSettingsSectionsProps): ApSettingsSectionsModel {
  const settingsCommitMode = onSettingsDraftCommit != null && readOnly !== true;
  const quotaCommitMode = onResourceQuotasCommit != null && readOnly !== true;
  const quotaDraftMode = settingsCommitMode || quotaCommitMode;
  const submissionStore = useMemo(
    () => getBrowserSettingsSubmissionStore(),
    []
  );
  const pendingSettingsStore = useMemo(
    () => getBrowserPendingSettingsStore(),
    []
  );
  const submissionEntries = useSettingsSubmissionEntries(
    submissionOwner,
    submissionStore
  );
  const initialCommittedReplicaStrategy = useMemo(
    () =>
      replicasQuota == null
        ? undefined
        : normalizeReplicaStrategy(replicaStrategy, replicasQuota.value),
    [replicaStrategy, replicasQuota]
  );
  const initialObservedSettingsDraft = useMemo<ApSettingsDraft>(
    () =>
      apSettingsDraftFromValues({
        args: normalizeCommandDraftLines(args),
        command: normalizeCommandDraftLines(command),
        configMaps: normalizeConfigMapDraftRows(configMaps),
        cpuCores: cpuQuota.value,
        env,
        envRawSource,
        image,
        memoryMib: memoryQuota.value,
        network,
        replicaStrategy: initialCommittedReplicaStrategy,
        storage: normalizeStorageDraftRows(storage),
        workloadKind,
      }),
    [
      args,
      command,
      configMaps,
      cpuQuota.value,
      env,
      envRawSource,
      image,
      initialCommittedReplicaStrategy,
      memoryQuota.value,
      network,
      storage,
      workloadKind,
    ]
  );
  const initialAcceptedPendingEntries =
    submissionOwner == null
      ? []
      : (pendingSettingsStore?.list(submissionOwner) ?? []);
  const initialAcceptedPendingOverlay = useMemo(
    () =>
      apAcceptedPendingTargets(
        initialObservedSettingsDraft,
        initialAcceptedPendingEntries
      ),
    [initialAcceptedPendingEntries, initialObservedSettingsDraft]
  );
  const initialSubmissionTargets = useMemo(
    () => apSettingsSubmissionTargets(submissionEntries),
    [submissionEntries]
  );
  const initialPendingSettingsDraft = useMemo(
    () =>
      applyApPendingTargets(
        initialObservedSettingsDraft,
        initialAcceptedPendingOverlay.targets
      ),
    [initialAcceptedPendingOverlay.targets, initialObservedSettingsDraft]
  );
  const initialSettingsDraft = useMemo(
    () =>
      applyApPendingTargets(
        initialPendingSettingsDraft,
        initialSubmissionTargets
      ),
    [initialPendingSettingsDraft, initialSubmissionTargets]
  );

  const [draftImage, setDraftImage] = useState(initialSettingsDraft.image);
  const [quotaSavePending, setQuotaSavePending] = useState(false);
  const [settingsSavePending, setSettingsSavePending] = useState(false);
  const [draftNetwork, setDraftNetwork] = useState<ApNetwork | undefined>(
    initialSettingsDraft.network
  );
  const [draftCommand, setDraftCommand] = useState<string[]>(() =>
    normalizeCommandDraftLines(initialSettingsDraft.command)
  );
  const [draftArgs, setDraftArgs] = useState<string[]>(() =>
    normalizeCommandDraftLines(initialSettingsDraft.args)
  );
  const imageInputId = useId();
  const envDraftKeyPrefix = useId();
  const envDraftKeyCounter = useRef(0);
  const [draftConfigMaps, setDraftConfigMaps] = useState<ApConfigMapMount[]>(
    () => normalizeConfigMapDraftRows(initialSettingsDraft.configMaps)
  );
  const [configMapDraftKeys, setConfigMapDraftKeys] = useState<string[]>(() =>
    createDraftRowKeys(
      normalizeConfigMapDraftRows(initialSettingsDraft.configMaps).length,
      "cm"
    )
  );
  // Per-card edit state for AP Configuration Files: which cards are expanded for
  // editing, which were added in this draft (Cancel removes them), and the
  // pre-edit snapshot used to revert an existing card on Cancel. All local to
  // the Settings Draft — the bottom Update is still the only backend write.
  const [expandedConfigKeys, setExpandedConfigKeys] = useState<Set<string>>(
    () => new Set()
  );
  const [newConfigKeys, setNewConfigKeys] = useState<Set<string>>(
    () => new Set()
  );
  const configEditSnapshots = useRef<Map<string, ApConfigMapMount>>(new Map());
  const [configSubmitBlocked, setConfigSubmitBlocked] = useState(false);
  const [draftStorage, setDraftStorage] = useState<ApStorageMount[]>(() =>
    normalizeStorageDraftRows(initialSettingsDraft.storage)
  );
  const [storageDraftKeys, setStorageDraftKeys] = useState<string[]>(() =>
    createDraftRowKeys(
      normalizeStorageDraftRows(initialSettingsDraft.storage).length,
      "storage"
    )
  );
  const initialEnvRawSource = useMemo(
    () =>
      canonicalApEnvRawSource({
        env: initialSettingsDraft.env,
        envRawSource: initialSettingsDraft.envRawSource,
      }),
    [initialSettingsDraft]
  );
  const initialEnvDraft = useMemo(
    () =>
      envRawSourceDraftWithAddReferenceIntent({
        intent: addDbDsnReferenceIntent,
        rawSource: initialEnvRawSource,
        readOnly,
        sources: dbDsnReferenceSources,
      }),
    [
      addDbDsnReferenceIntent,
      dbDsnReferenceSources,
      initialEnvRawSource,
      readOnly,
    ]
  );
  // Seed per-row edit state for AP environment reference rows added by a canvas
  // Add Reference intent so they open editable on first render. Computed once;
  // createEnvDraftKeys advances the shared key counter, so this owns the initial
  // envDraftKeys too.
  const initialEnvEditState = useRef<{
    expanded: Set<string>;
    keys: string[];
    newKeys: Set<string>;
  } | null>(null);
  if (initialEnvEditState.current === null) {
    const keys = createEnvDraftKeys(
      initialEnvDraft.rows.length,
      envDraftKeyPrefix,
      envDraftKeyCounter
    );
    const expanded = new Set<string>();
    const newKeys = new Set<string>();
    for (const [index, row] of initialEnvDraft.rows.entries()) {
      const key = keys[index];
      if (row.canvasAddDbDsnReferenceIntentId != null && key != null) {
        expanded.add(key);
        newKeys.add(key);
      }
    }
    initialEnvEditState.current = { expanded, keys, newKeys };
  }
  const [envEditorMode, setEnvEditorMode] = useState<EnvEditorMode>(() =>
    parseApEnvRawSource(initialEnvDraft.rawSource).valid ? "structured" : "raw"
  );
  const processedAddDbDsnReferenceIntentId = useRef<string | null>(
    initialEnvDraft.consumedIntentId ?? null
  );
  const syncedEnvRef = useRef<readonly ApEnvVar[]>(initialEnvDraft.rows);
  const syncedEnvRawSourceRef = useRef<string>(initialEnvDraft.rawSource);
  const [envRawSourceDraft, setEnvRawSourceDraft] = useState(
    initialEnvDraft.rawSource
  );
  const [envDraft, setEnvDraft] = useState<EnvDraftRow[]>(
    () => initialEnvDraft.rows
  );
  const [envDraftKeys, setEnvDraftKeys] = useState<string[]>(
    () => initialEnvEditState.current?.keys ?? []
  );
  const [revealedEnvValues, setRevealedEnvValues] = useState<
    Map<number, string>
  >(() => new Map());
  const [copiedEnvValueIndex, setCopiedEnvValueIndex] = useState<number | null>(
    null
  );
  // Per-row edit state for AP environment rows, mirroring the AP Configuration
  // File card model: which rows are expanded for editing, which were added in
  // this draft (Cancel removes them), and the pre-edit snapshot used to revert
  // an existing row on Cancel. Local to the Settings Draft — the bottom Update
  // (or non-commit Save) is still the only write.
  const [expandedEnvKeys, setExpandedEnvKeys] = useState<Set<string>>(
    () => new Set(initialEnvEditState.current?.expanded)
  );
  const [newEnvKeys, setNewEnvKeys] = useState<Set<string>>(
    () => new Set(initialEnvEditState.current?.newKeys)
  );
  const envEditSnapshots = useRef<Map<string, { name: string; value: string }>>(
    new Map()
  );
  const [envSubmitBlocked, setEnvSubmitBlocked] = useState(false);
  const revealTimeouts = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  const copiedEnvValueTimeout = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const [draftCpu, setDraftCpu] = useState(initialSettingsDraft.cpuCores);
  const [draftMem, setDraftMem] = useState(initialSettingsDraft.memoryMib);
  const [draftReplicaStrategy, setDraftReplicaStrategy] = useState(() =>
    normalizeReplicaStrategy(
      initialSettingsDraft.replicaStrategy,
      initialSettingsDraft.replicas ??
        replicasQuota?.value ??
        DEFAULT_FIXED_REPLICAS
    )
  );

  useEffect(() => {
    if (expandedConfigKeys.size === 0) {
      setConfigSubmitBlocked(false);
    }
  }, [expandedConfigKeys]);

  useEffect(() => {
    if (expandedEnvKeys.size === 0) {
      setEnvSubmitBlocked(false);
    }
  }, [expandedEnvKeys]);

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
    setDraftCommand(normalizeCommandDraftLines(command));
    setDraftArgs(normalizeCommandDraftLines(args));
    const nextConfigMaps = normalizeConfigMapDraftRows(configMaps);
    setDraftConfigMaps(nextConfigMaps);
    setConfigMapDraftKeys(createDraftRowKeys(nextConfigMaps.length, "cm"));
    setExpandedConfigKeys(new Set());
    setNewConfigKeys(new Set());
    configEditSnapshots.current = new Map();
    setConfigSubmitBlocked(false);
    const nextStorage = normalizeStorageDraftRows(storage);
    setDraftStorage(nextStorage);
    setStorageDraftKeys(createDraftRowKeys(nextStorage.length, "storage"));
  }, [args, command, configMaps, settingsCommitMode, storage]);

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
    const nextRawSource = canonicalApEnvRawSource({ env, envRawSource });
    if (
      apEnvRowsModelEqual(env, syncedEnvRef.current) &&
      nextRawSource === syncedEnvRawSourceRef.current
    ) {
      return;
    }
    syncedEnvRef.current = env;
    syncedEnvRawSourceRef.current = nextRawSource;
    const nextEnv = envDraftRowsFromRawSource(nextRawSource);
    setEnvRawSourceDraft(nextRawSource);
    setEnvDraft(nextEnv);
    setEnvDraftKeys(
      createEnvDraftKeys(nextEnv.length, envDraftKeyPrefix, envDraftKeyCounter)
    );
  }, [env, envDraftKeyPrefix, envRawSource, settingsCommitMode]);

  const clearRevealTimeouts = useCallback(() => {
    for (const timeout of revealTimeouts.current.values()) {
      clearTimeout(timeout);
    }
    revealTimeouts.current.clear();
  }, []);

  const clearRevealedEnvValues = useCallback(() => {
    clearRevealTimeouts();
    setRevealedEnvValues(new Map());
  }, [clearRevealTimeouts]);

  useEffect(() => clearRevealTimeouts, [clearRevealTimeouts]);

  const clearCopiedEnvValueTimeout = useCallback(() => {
    if (copiedEnvValueTimeout.current == null) {
      return;
    }
    clearTimeout(copiedEnvValueTimeout.current);
    copiedEnvValueTimeout.current = null;
  }, []);

  const clearCopiedEnvValueFeedback = useCallback(() => {
    clearCopiedEnvValueTimeout();
    setCopiedEnvValueIndex(null);
  }, [clearCopiedEnvValueTimeout]);

  useEffect(() => clearCopiedEnvValueTimeout, [clearCopiedEnvValueTimeout]);

  const showCopiedEnvValueFeedback = useCallback(
    (index: number) => {
      clearCopiedEnvValueTimeout();
      setCopiedEnvValueIndex(index);
      copiedEnvValueTimeout.current = setTimeout(() => {
        setCopiedEnvValueIndex(null);
        copiedEnvValueTimeout.current = null;
      }, CANVAS_NODE_DEFAULT_COPIED_FEEDBACK_MS);
    },
    [clearCopiedEnvValueTimeout]
  );

  const resolvedEnvValuesAvailable = onEnvResolvedValue != null;
  const revealResetKey = JSON.stringify([
    envResolvedValueScope ?? "",
    envEditorMode,
    initialEnvRawSource,
    resolvedEnvValuesAvailable,
  ]);
  const previousRevealResetKey = useRef<string | null>(null);
  useEffect(() => {
    if (previousRevealResetKey.current === revealResetKey) {
      return;
    }
    previousRevealResetKey.current = revealResetKey;
    clearRevealedEnvValues();
    clearCopiedEnvValueFeedback();
    setExpandedEnvKeys(new Set());
    setNewEnvKeys(new Set());
    envEditSnapshots.current = new Map();
  }, [clearCopiedEnvValueFeedback, clearRevealedEnvValues, revealResetKey]);

  const markEnvKeysAddedOpen = useCallback((addedKeys: readonly string[]) => {
    if (addedKeys.length === 0) {
      return;
    }
    const addKeys = (current: Set<string>) => {
      const next = new Set(current);
      for (const key of addedKeys) {
        next.add(key);
      }
      return next;
    };
    setExpandedEnvKeys(addKeys);
    setNewEnvKeys(addKeys);
  }, []);

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

    setEnvRawSourceDraft((rawSource) => {
      const result = envRawSourceDraftWithAddReferenceIntent({
        intent,
        rawSource,
        readOnly,
        sources: dbDsnReferenceSources,
      });
      setEnvDraft(result.rows);
      setEnvDraftKeys((keys) => {
        const nextKeys = resizeEnvDraftKeys(
          keys,
          result.rows.length,
          envDraftKeyPrefix,
          envDraftKeyCounter
        );
        // A dragged DB reference opens editable, mirroring the Add button.
        markEnvKeysAddedOpen(nextKeys.slice(keys.length));
        return nextKeys;
      });
      return result.rawSource;
    });
  }, [
    addDbDsnReferenceIntent,
    dbDsnReferenceSources,
    envDraftKeyPrefix,
    markEnvKeysAddedOpen,
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

  const envValidation = useMemo(() => validateApEnvRows(envDraft), [envDraft]);
  const envRawSourceParse = useMemo(
    () => parseApEnvRawSource(envRawSourceDraft),
    [envRawSourceDraft]
  );
  const envRuntimeCompile = useMemo(
    () =>
      compileApEnvRawSourceForRuntime(envRawSourceDraft, dbDsnReferenceSources),
    [dbDsnReferenceSources, envRawSourceDraft]
  );
  const envTokenDiagnostics = useMemo(
    () =>
      envRuntimeCompile.diagnostics.map((diagnostic) => ({
        message: diagnostic.message,
        type: "unresolved-token" as const,
      })),
    [envRuntimeCompile.diagnostics]
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
  const activeDraftNetwork = settingsCommitMode
    ? draftNetwork
    : (draftNetwork ?? network);
  const applyNetworkDraft = useCallback(
    (next: ApNetwork) => {
      if (settingsCommitMode) {
        setDraftNetwork(next);
        return;
      }
      return onNetworkChange?.(next);
    },
    [onNetworkChange, settingsCommitMode]
  );
  const networkController = useApNetworkDraftController({
    network: activeDraftNetwork ?? EMPTY_AP_NETWORK,
    onNetworkChange:
      activeDraftNetwork == null || readOnly ? undefined : applyNetworkDraft,
    readOnly,
  });
  const settingsDraftNetwork = activeDraftNetwork;
  const committedReplicaStrategy = useMemo(
    () =>
      replicasQuota == null
        ? undefined
        : normalizeReplicaStrategy(replicaStrategy, replicasQuota.value),
    [replicaStrategy, replicasQuota]
  );
  const observedSettingsDraft = useMemo<ApSettingsDraft>(
    () =>
      apSettingsDraftFromValues({
        args: normalizeCommandDraftLines(args),
        command: normalizeCommandDraftLines(command),
        configMaps: normalizeConfigMapDraftRows(configMaps),
        cpuCores: cpuQuota.value,
        env,
        envRawSource,
        image,
        memoryMib: memoryQuota.value,
        network,
        replicaStrategy: committedReplicaStrategy,
        storage: normalizeStorageDraftRows(storage),
        workloadKind,
      }),
    [
      args,
      command,
      committedReplicaStrategy,
      configMaps,
      cpuQuota.value,
      env,
      envRawSource,
      image,
      memoryQuota.value,
      network,
      storage,
      workloadKind,
    ]
  );
  const acceptedPendingEntries =
    submissionOwner == null
      ? []
      : (pendingSettingsStore?.list(submissionOwner) ?? []);
  const acceptedPendingOverlay = useMemo(
    () =>
      apAcceptedPendingTargets(observedSettingsDraft, acceptedPendingEntries),
    [acceptedPendingEntries, observedSettingsDraft]
  );
  useEffect(() => {
    if (
      submissionOwner == null ||
      pendingSettingsStore == null ||
      acceptedPendingOverlay.reconciledDomains.length === 0
    ) {
      return;
    }
    for (const domain of acceptedPendingOverlay.reconciledDomains) {
      pendingSettingsStore.clear(submissionOwner, domain);
    }
  }, [
    acceptedPendingOverlay.reconciledDomains,
    pendingSettingsStore,
    submissionOwner,
  ]);
  const activeSubmissionTargets = useMemo(
    () => apSettingsSubmissionTargets(submissionEntries),
    [submissionEntries]
  );
  const pendingSettingsDraft = useMemo(
    () =>
      applyApPendingTargets(
        observedSettingsDraft,
        acceptedPendingOverlay.targets
      ),
    [acceptedPendingOverlay.targets, observedSettingsDraft]
  );
  const originalSettingsDraft = useMemo(
    () => applyApPendingTargets(pendingSettingsDraft, activeSubmissionTargets),
    [activeSubmissionTargets, pendingSettingsDraft]
  );
  const originalSettingsDraftKey = useMemo(
    () => apSettingsDraftBackingKey(originalSettingsDraft),
    [originalSettingsDraft]
  );
  const settingsDraft = useMemo<ApSettingsDraft>(
    () =>
      apSettingsDraftFromValues({
        args: draftArgs,
        command: draftCommand,
        configMaps: draftConfigMaps,
        cpuCores: draftCpu,
        env: envDraft,
        envRawSource: envRawSourceDraft,
        image: draftImage,
        memoryMib: draftMem,
        network: settingsDraftNetwork,
        replicaStrategy:
          replicasQuota == null ? undefined : draftReplicaStrategy,
        storage: draftStorage,
        workloadKind,
      }),
    [
      draftArgs,
      draftCommand,
      draftConfigMaps,
      draftCpu,
      draftImage,
      draftMem,
      draftReplicaStrategy,
      draftStorage,
      envDraft,
      envRawSourceDraft,
      replicasQuota,
      settingsDraftNetwork,
      workloadKind,
    ]
  );
  const [settingsBackingState, setSettingsBackingState] = useState(() =>
    createSettingsDraftBackingState(
      originalSettingsDraft,
      originalSettingsDraftKey
    )
  );
  const latestSettingsDraftRef = useRef(settingsDraft);
  const latestSettingsBackingStateRef = useRef(settingsBackingState);
  useEffect(() => {
    latestSettingsDraftRef.current = settingsDraft;
    latestSettingsBackingStateRef.current = settingsBackingState;
  }, [settingsBackingState, settingsDraft]);
  const applySettingsDraftToLocalState = useCallback(
    (next: ApSettingsDraft) => {
      setDraftImage(next.image);
      setDraftCpu(next.cpuCores);
      setDraftMem(next.memoryMib);
      setDraftReplicaStrategy(
        normalizeReplicaStrategy(
          next.replicaStrategy,
          next.replicas ?? replicasQuota?.value ?? DEFAULT_FIXED_REPLICAS
        )
      );
      const nextRawSource = canonicalApEnvRawSource({
        env: next.env,
        envRawSource: next.envRawSource,
      });
      const nextEnv = envDraftRowsFromRawSource(nextRawSource);
      setEnvRawSourceDraft(nextRawSource);
      setEnvDraft(nextEnv);
      setEnvDraftKeys(
        createEnvDraftKeys(
          nextEnv.length,
          envDraftKeyPrefix,
          envDraftKeyCounter
        )
      );
      syncedEnvRef.current = nextEnv;
      syncedEnvRawSourceRef.current = nextRawSource;
      setDraftNetwork(next.network);
      setDraftCommand(normalizeCommandDraftLines(next.command));
      setDraftArgs(normalizeCommandDraftLines(next.args));
      const nextConfigMaps = normalizeConfigMapDraftRows(next.configMaps);
      setDraftConfigMaps(nextConfigMaps);
      setConfigMapDraftKeys(createDraftRowKeys(nextConfigMaps.length, "cm"));
      setExpandedConfigKeys(new Set());
      setNewConfigKeys(new Set());
      configEditSnapshots.current = new Map();
      setConfigSubmitBlocked(false);
      const nextStorage = normalizeStorageDraftRows(next.storage);
      setDraftStorage(nextStorage);
      setStorageDraftKeys(createDraftRowKeys(nextStorage.length, "storage"));
    },
    [envDraftKeyPrefix, replicasQuota?.value]
  );
  const rejectedSettingsSubmission = useMemo(
    () => latestRejectedSettingsSubmission<ApSettingsDraft>(submissionEntries),
    [submissionEntries]
  );
  const canApplyRejectedSettingsSubmission =
    rejectedSettingsSubmission != null &&
    !apSettingsDraftIsDirty(settingsBackingState.base, settingsDraft);
  const appliedRejectedSubmissionId = useRef<string | null>(null);
  useEffect(() => {
    if (
      !(settingsCommitMode && canApplyRejectedSettingsSubmission) ||
      rejectedSettingsSubmission == null ||
      submissionOwner == null ||
      submissionStore == null ||
      appliedRejectedSubmissionId.current ===
        rejectedSettingsSubmission.submissionId
    ) {
      return;
    }

    appliedRejectedSubmissionId.current =
      rejectedSettingsSubmission.submissionId;
    applySettingsDraftToLocalState(rejectedSettingsSubmission.draft);
    setSettingsBackingState({
      ...createSettingsDraftBackingState(
        rejectedSettingsSubmission.baseDraft,
        apSettingsDraftBackingKey(rejectedSettingsSubmission.baseDraft)
      ),
      latest: originalSettingsDraft,
      latestKey: originalSettingsDraftKey,
      saveFailureMessage: settingsDraftSaveFailureMessage(
        rejectedSettingsSubmission.errorMessage == null
          ? new Error("Update failed.")
          : new Error(rejectedSettingsSubmission.errorMessage),
        "Could not submit settings."
      ),
    });
    submissionStore.clear({
      domains: rejectedSettingsSubmission.domains,
      owner: submissionOwner,
      statuses: ["rejected"],
    });
  }, [
    applySettingsDraftToLocalState,
    canApplyRejectedSettingsSubmission,
    originalSettingsDraft,
    originalSettingsDraftKey,
    rejectedSettingsSubmission,
    settingsCommitMode,
    submissionOwner,
    submissionStore,
  ]);
  useEffect(() => {
    if (!settingsCommitMode || canApplyRejectedSettingsSubmission) {
      return;
    }
    const synced = syncSettingsDraftBackingState(settingsBackingState, {
      backing: originalSettingsDraft,
      backingKey: originalSettingsDraftKey,
      draft: settingsDraft,
      isDirty: apSettingsDraftIsDirty,
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
    canApplyRejectedSettingsSubmission,
  ]);
  const settingsBaseDraft = settingsBackingState.base;
  const committedEnvRawSource = settingsCommitMode
    ? canonicalApEnvRawSource({
        env: settingsBaseDraft.env,
        envRawSource: settingsBaseDraft.envRawSource,
      })
    : canonicalApEnvRawSource({ env, envRawSource });
  const committedEnvRows = useMemo(
    () => envDraftRowsFromRawSource(committedEnvRawSource),
    [committedEnvRawSource]
  );
  const envDirty = envRawSourceDraft !== committedEnvRawSource;
  const pendingDbReferences = useMemo(
    () =>
      pendingDbReferencesFromEnvRawSourceDraft({
        committedRawSource: committedEnvRawSource,
        draftRawSource: envRawSourceDraft,
        sources: dbDsnReferenceSources,
      }),
    [committedEnvRawSource, dbDsnReferenceSources, envRawSourceDraft]
  );
  useEffect(() => {
    if (onPendingDbReferencesChange == null || readOnly) {
      return;
    }
    if (pendingDbReferences === undefined) {
      return;
    }
    onPendingDbReferencesChange(pendingDbReferences);
  }, [onPendingDbReferencesChange, pendingDbReferences, readOnly]);
  useEffect(
    () => () => {
      onPendingDbReferencesChange?.([]);
    },
    [onPendingDbReferencesChange]
  );
  const resolveSavedEnvValue = useCallback(
    (index: number) => {
      if (onEnvResolvedValue == null) {
        return undefined;
      }
      const row = envDraft[index];
      const savedRow = committedEnvRows[index];
      if (
        row == null ||
        savedRow == null ||
        !apEnvRowsModelEqual([row], [savedRow])
      ) {
        return undefined;
      }
      return onEnvResolvedValue(row.name);
    },
    [committedEnvRows, envDraft, onEnvResolvedValue]
  );
  const hideResolvedEnvValue = useCallback((index: number) => {
    const existingTimeout = revealTimeouts.current.get(index);
    if (existingTimeout !== undefined) {
      clearTimeout(existingTimeout);
      revealTimeouts.current.delete(index);
    }
    setRevealedEnvValues((current) => {
      if (!current.has(index)) {
        return current;
      }
      const next = new Map(current);
      next.delete(index);
      return next;
    });
  }, []);
  const revealResolvedEnvValue = useCallback(
    async (index: number) => {
      if (revealedEnvValues.has(index)) {
        hideResolvedEnvValue(index);
        return;
      }
      let value: string | undefined;
      try {
        value = await resolveSavedEnvValue(index);
      } catch {
        return;
      }
      if (value === undefined) {
        return;
      }
      const existingTimeout = revealTimeouts.current.get(index);
      if (existingTimeout !== undefined) {
        clearTimeout(existingTimeout);
      }
      setRevealedEnvValues((current) => {
        const next = new Map(current);
        next.set(index, value);
        return next;
      });
      revealTimeouts.current.set(
        index,
        setTimeout(() => {
          revealTimeouts.current.delete(index);
          setRevealedEnvValues((current) => {
            const next = new Map(current);
            next.delete(index);
            return next;
          });
        }, ENV_REVEAL_DURATION_MS)
      );
    },
    [hideResolvedEnvValue, resolveSavedEnvValue, revealedEnvValues]
  );
  const copyResolvedEnvValue = useCallback(
    async (index: number) => {
      let value: string | undefined;
      try {
        value = await resolveSavedEnvValue(index);
      } catch {
        return;
      }
      if (value === undefined) {
        return;
      }
      await writeTextToClipboard(value);
      showCopiedEnvValueFeedback(index);
    },
    [resolveSavedEnvValue, showCopiedEnvValueFeedback]
  );
  const editEnvRow = (index: number) => {
    const key = envDraftKeys[index];
    if (key == null) {
      return;
    }
    const row = envDraft[index];
    if (row != null) {
      envEditSnapshots.current.set(key, { name: row.name, value: row.value });
    }
    setExpandedEnvKeys((current) => new Set(current).add(key));
  };
  const canSaveEnv =
    envDirty &&
    envRawSourceParse.valid &&
    envRuntimeCompile.valid &&
    envValidation.valid;
  const dirtySettingsDomains = useMemo(
    () =>
      AP_SETTINGS_DRAFT_DOMAINS.filter((domain) =>
        apSettingsDraftDomainIsDirty(domain, settingsBaseDraft, settingsDraft)
      ),
    [settingsBaseDraft, settingsDraft]
  );
  const submittingSettingsDomains = useMemo(
    () =>
      new Set(
        submissionEntries
          .filter((entry) => entry.status === "submitting")
          .map((entry) => entry.domain)
      ),
    [submissionEntries]
  );
  const hasOverlappingSubmittingSettingsDomain = dirtySettingsDomains.some(
    (domain) => submittingSettingsDomains.has(domain)
  );
  const settingsDirty = dirtySettingsDomains.length > 0;
  const panelDraftDirty = settingsDirty;
  const storageHasShrink = useMemo(
    () =>
      draftStorage.some((row) => {
        const current = (initialSettingsDraft.storage ?? []).find(
          (mount) => mount.path === row.path
        );
        return current ? isStorageShrink(row.size, current.size) : false;
      }),
    [draftStorage, initialSettingsDraft.storage]
  );
  const canSaveSettings =
    settingsCommitMode &&
    panelDraftDirty &&
    envRawSourceParse.valid &&
    envRuntimeCompile.valid &&
    envValidation.valid &&
    envTokenDiagnostics.length === 0 &&
    !settingsSavePending &&
    !hasOverlappingSubmittingSettingsDomain &&
    !storageHasShrink;

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
    const result = compileApEnvRawSourceForRuntime(
      envRawSourceDraft,
      dbDsnReferenceSources
    );
    if (!result.valid) {
      return;
    }
    const normalized = result.env;
    onEnvChange(normalized, { envRawSource: result.envRawSource });
    setEnvDraft(envDraftRowsFromRawSource(result.envRawSource));
  };

  const handleCancelEnvRows = () => {
    const nextRawSource = canonicalApEnvRawSource({ env, envRawSource });
    const nextEnv = envDraftRowsFromRawSource(nextRawSource);
    setEnvRawSourceDraft(nextRawSource);
    setEnvDraft(nextEnv);
    setEnvDraftKeys(
      createEnvDraftKeys(nextEnv.length, envDraftKeyPrefix, envDraftKeyCounter)
    );
  };

  const handleAddEnvRow = () => {
    const key = nextEnvDraftKey(envDraftKeyPrefix, envDraftKeyCounter);
    setEnvRawSourceDraft((source) => {
      const nextRow = addApEnvRow(envDraftRowsFromRawSource(source)).at(-1);
      if (nextRow === undefined) {
        return source;
      }
      const parsed = appendApEnvRawSourceRow(source, nextRow);
      setEnvDraft(envDraftRowsFromRawParse(parsed));
      return parsed.source;
    });
    setEnvDraftKeys((keys) => [...keys, key]);
    setExpandedEnvKeys((current) => new Set(current).add(key));
    setNewEnvKeys((current) => new Set(current).add(key));
  };

  const handleDeleteEnvRow = (index: number) => {
    setEnvRawSourceDraft((source) => {
      const result = deleteApEnvRawSourceRow(source, index);
      const refreshed = envDraftRowsFromRawParse(result);
      setEnvDraftKeys((keys) =>
        resizeEnvDraftKeys(
          keys.filter((_, keyIndex) => keyIndex !== index),
          refreshed.length,
          envDraftKeyPrefix,
          envDraftKeyCounter
        )
      );
      setEnvDraft(refreshed);
      return result.source;
    });
  };

  const dropEnvEditKey = (key: string) => {
    envEditSnapshots.current.delete(key);
    setNewEnvKeys((current) => {
      if (!current.has(key)) {
        return current;
      }
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    setExpandedEnvKeys((current) => {
      if (!current.has(key)) {
        return current;
      }
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  // Per-row Save confirms the row back into the draft and collapses it; the
  // live value is already in the Raw Source, so there is no backend write here.
  const handleSaveEnvRow = (index: number) => {
    const key = envDraftKeys[index];
    if (key == null) {
      return;
    }
    dropEnvEditKey(key);
  };

  // Per-row Cancel removes a newly-added row, or restores an existing row to its
  // pre-edit snapshot, then collapses it.
  const handleCancelEnvRow = (index: number) => {
    const key = envDraftKeys[index];
    if (key == null) {
      return;
    }
    if (newEnvKeys.has(key)) {
      handleDeleteEnvRow(index);
      dropEnvEditKey(key);
      return;
    }
    const snapshot = envEditSnapshots.current.get(key);
    if (snapshot != null) {
      setEnvRawSourceDraft((source) => {
        const result = applyApEnvRawSourceRowPatch(source, index, {
          name: snapshot.name,
          value: snapshot.value,
        });
        const refreshed = envDraftRowsFromRawParse(result);
        setEnvDraftKeys((keys) =>
          resizeEnvDraftKeys(
            keys,
            refreshed.length,
            envDraftKeyPrefix,
            envDraftKeyCounter
          )
        );
        setEnvDraft(refreshed);
        return result.source;
      });
    }
    dropEnvEditKey(key);
  };

  const collapseConfigCard = (key: string) => {
    setExpandedConfigKeys((current) => {
      if (!current.has(key)) {
        return current;
      }
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  const handleAddConfigMapRow = () => {
    const key = createDraftRowKey("cm");
    setDraftConfigMaps((rows) => [...rows, { path: "", value: "" }]);
    setConfigMapDraftKeys((keys) => [...keys, key]);
    setExpandedConfigKeys((current) => new Set(current).add(key));
    setNewConfigKeys((current) => new Set(current).add(key));
  };

  const handleEditConfigMapRow = (index: number) => {
    const key = configMapDraftKeys[index];
    if (key == null) {
      return;
    }
    const row = draftConfigMaps[index];
    if (row != null) {
      configEditSnapshots.current.set(key, { ...row });
    }
    setExpandedConfigKeys((current) => new Set(current).add(key));
  };

  const handleSaveConfigMapRow = (index: number) => {
    const key = configMapDraftKeys[index];
    if (key == null) {
      return;
    }
    configEditSnapshots.current.delete(key);
    setNewConfigKeys((current) => {
      if (!current.has(key)) {
        return current;
      }
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    collapseConfigCard(key);
  };

  const handleCancelConfigMapRow = (index: number) => {
    const key = configMapDraftKeys[index];
    if (key == null) {
      return;
    }
    if (newConfigKeys.has(key)) {
      setDraftConfigMaps((rows) =>
        rows.filter((_, rowIndex) => rowIndex !== index)
      );
      setConfigMapDraftKeys((keys) =>
        keys.filter((_, keyIndex) => keyIndex !== index)
      );
      setNewConfigKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    } else {
      const snapshot = configEditSnapshots.current.get(key);
      if (snapshot != null) {
        setDraftConfigMaps((rows) =>
          rows.map((row, rowIndex) =>
            rowIndex === index ? { ...snapshot } : row
          )
        );
      }
    }
    configEditSnapshots.current.delete(key);
    collapseConfigCard(key);
  };

  const handleDeleteConfigMapRow = (index: number) => {
    const key = configMapDraftKeys[index];
    setDraftConfigMaps((rows) =>
      rows.filter((_, rowIndex) => rowIndex !== index)
    );
    setConfigMapDraftKeys((keys) =>
      keys.filter((_, keyIndex) => keyIndex !== index)
    );
    if (key != null) {
      configEditSnapshots.current.delete(key);
      setNewConfigKeys((current) => {
        if (!current.has(key)) {
          return current;
        }
        const next = new Set(current);
        next.delete(key);
        return next;
      });
      collapseConfigCard(key);
    }
  };

  const handleUpdateConfigMapRow = (
    index: number,
    patch: Partial<ApConfigMapMount>
  ) => {
    setDraftConfigMaps((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row
      )
    );
  };

  const handleUpdateStorageRow = (
    index: number,
    patch: Partial<ApStorageMount>
  ) => {
    setDraftStorage((rows) =>
      rows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch, path: row.path } : row
      )
    );
  };

  const handleUpdateEnvRow = (index: number, patch: Partial<ApEnvRow>) => {
    setEnvRawSourceDraft((source) => {
      const result = applyApEnvRawSourceRowPatch(source, index, patch);
      const refreshed = envDraftRowsFromRawParse(result);
      setEnvDraftKeys((keys) =>
        resizeEnvDraftKeys(
          keys,
          refreshed.length,
          envDraftKeyPrefix,
          envDraftKeyCounter
        )
      );
      setEnvDraft(refreshed);
      return result.source;
    });
  };

  const handleRawSourceChange = (source: string) => {
    setEnvRawSourceDraft(source);
    const parsed = parseApEnvRawSource(source);
    if (!parsed.valid) {
      setEnvEditorMode("raw");
      return;
    }
    const nextRows = envDraftRowsFromRawParse(parsed);
    setEnvDraft(nextRows);
    setEnvDraftKeys((keys) =>
      resizeEnvDraftKeys(
        keys,
        nextRows.length,
        envDraftKeyPrefix,
        envDraftKeyCounter
      )
    );
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

  const saveSettingsDraft = useCallback(() => {
    if (!canSaveSettings || onSettingsDraftCommit == null) {
      throw new Error("Settings draft cannot be saved yet.");
    }
    const result = compileApEnvRawSourceForRuntime(
      envRawSourceDraft,
      dbDsnReferenceSources
    );
    if (!result.valid) {
      throw new Error(result.diagnostics[0]?.message ?? "Invalid environment.");
    }
    const normalizedEnv = result.env;
    const draft: ApSettingsDraft = {
      ...settingsDraft,
      args: normalizeCommandDraftLines(settingsDraft.args),
      command: normalizeCommandDraftLines(settingsDraft.command),
      configMaps: normalizeConfigMapDraftRows(settingsDraft.configMaps),
      env: normalizedEnv,
      envRawSource: result.envRawSource,
      image: settingsDraft.image.trim(),
      storage: normalizeStorageDraftRows(settingsDraft.storage),
    };
    const prepared = prepareSettingsDraftSubmit(settingsBackingState, {
      conflictMessage: AP_SETTINGS_SUBMIT_CONFLICT_MESSAGE,
      domains: AP_SETTINGS_DRAFT_DOMAINS,
      draft,
      isDomainDirty: apSettingsDraftDomainIsDirty,
      mergeDraft: mergeApSettingsDraftDomains,
    });
    setSettingsBackingState(prepared.state);
    if (prepared.status === "conflict") {
      throw new Error(AP_SETTINGS_SUBMIT_CONFLICT_MESSAGE);
    }
    const commitDraft = prepared.draft;
    const meta: ApSettingsDraftCommitMeta = {
      baseDraft: prepared.base,
    };
    const submissionUpdates = apSettingsSubmissionUpdates(
      prepared.base,
      commitDraft
    );
    const submissionStart =
      submissionOwner == null || submissionStore == null
        ? { entries: [], status: "started" as const }
        : submissionStore.start({
            baseDraft: prepared.base,
            draft: commitDraft,
            owner: submissionOwner,
            updates: submissionUpdates,
          });
    if (submissionStart.status === "blocked") {
      throw new Error("Settings update is already submitting.");
    }
    const startedSubmissionEntries = submissionStart.entries;
    setSettingsSavePending(true);
    setSettingsBackingState((current) => ({
      ...current,
      saveFailureMessage: null,
    }));
    setSettingsBackingState((current) =>
      commitSettingsDraftBackingState(
        current,
        commitDraft,
        apSettingsDraftBackingKey(commitDraft)
      )
    );
    applySettingsDraftToLocalState(commitDraft);
    const committedRawSource = canonicalApEnvRawSource({
      env: commitDraft.env,
      envRawSource: commitDraft.envRawSource,
    });
    setEnvDraft(
      envDraftRowsFromRawSource(committedRawSource).map((row, index) => {
        const intentId = envDraft[index]?.canvasAddDbDsnReferenceIntentId;
        return intentId == null
          ? row
          : { ...row, canvasAddDbDsnReferenceIntentId: intentId };
      })
    );
    setEnvRawSourceDraft(committedRawSource);
    setSettingsSavePending(false);

    const toastId = toast.loading("Submitting settings update...");
    Promise.resolve()
      .then(() => onSettingsDraftCommit(commitDraft, meta))
      .then(() => {
        if (submissionOwner != null && submissionStore != null) {
          submissionStore.accept({
            entries: startedSubmissionEntries,
            owner: submissionOwner,
            pendingStore: pendingSettingsStore,
          });
        }
        toast.success("Update accepted. Applying changes.", { id: toastId });
      })
      .catch((error) => {
        if (submissionOwner != null && submissionStore != null) {
          submissionStore.reject({
            entries: startedSubmissionEntries,
            error,
            owner: submissionOwner,
          });
        } else {
          setSettingsBackingState(
            failSettingsDraftSave(
              prepared.state,
              error,
              "Could not submit settings."
            )
          );
          applySettingsDraftToLocalState(commitDraft);
        }
        toastErrorDetail(
          "Could not submit settings.",
          settingsDraftSaveFailureMessage(error, "Could not submit settings."),
          {
            action: {
              label: "Back to draft",
              onClick: () => {
                if (
                  apSettingsDraftIsDirty(
                    latestSettingsBackingStateRef.current.base,
                    latestSettingsDraftRef.current
                  )
                ) {
                  return;
                }
                setSettingsBackingState(
                  failSettingsDraftSave(
                    prepared.state,
                    error,
                    "Could not submit settings."
                  )
                );
                applySettingsDraftToLocalState(commitDraft);
              },
            },
            id: toastId,
          }
        );
      });
  }, [
    canSaveSettings,
    applySettingsDraftToLocalState,
    dbDsnReferenceSources,
    envDraft,
    envRawSourceDraft,
    onSettingsDraftCommit,
    pendingSettingsStore,
    settingsBackingState,
    settingsDraft,
    submissionOwner,
    submissionStore,
  ]);

  const handleSaveSettingsDraft = useCallback(async () => {
    // A still-expanded AP Configuration File card or AP environment row is an
    // unsaved edit. Block the panel submit, surface the per-row prompt, and
    // scroll to the first one.
    const configOpen = expandedConfigKeys.size > 0;
    const envOpen = expandedEnvKeys.size > 0;
    if (configOpen || envOpen) {
      if (configOpen) {
        setConfigSubmitBlocked(true);
      }
      if (envOpen) {
        setEnvSubmitBlocked(true);
      }
      scrollFirstUnsavedSettingIntoView(
        configOpen
          ? '[data-config-card="expanded"]'
          : '[data-env-row="editing"]'
      );
      return;
    }
    try {
      await saveSettingsDraft();
    } catch {
      // The footer keeps the user on the draft and shows the panel-level failure.
    }
  }, [expandedConfigKeys, expandedEnvKeys, saveSettingsDraft]);

  const environmentFocus = sectionFocus === "environment";

  const leaveGuard: SettingsLeaveGuardHandle | null =
    settingsCommitMode && panelDraftDirty
      ? {
          canSave: canSaveSettings,
          dirty: true,
          discard: resetSettingsDraft,
          save: saveSettingsDraft,
          scope: environmentFocus ? "environmentVariables" : "ap",
        }
      : null;

  const displayImage = draftImage;
  const networkForRender = settingsCommitMode ? activeDraftNetwork : network;
  const envEditorControls = readOnly ? null : (
    <div className="flex min-w-0 flex-col gap-2">
      <SlidingToggle
        ariaLabel="Environment editor mode"
        className="h-9 w-full"
        disabled={readOnly}
        indicatorClassName="rounded-md"
        itemClassName="!rounded-md h-9 min-w-0 px-2 text-foreground text-sm"
        onValueChange={setEnvEditorMode}
        options={ENV_EDITOR_MODE_TOGGLE_OPTIONS.map((option) =>
          option.value === "structured"
            ? { ...option, disabled: envRawSourceParse.diagnostics.length > 0 }
            : option
        )}
        value={envEditorMode}
      />
      {envEditorMode === "structured" ? (
        <AppButton
          aria-label="Add environment variable"
          className="h-9 w-full rounded-lg bg-white/5 text-primary text-sm hover:bg-input"
          onClick={handleAddEnvRow}
          size="default"
          type="button"
          variant="secondary"
        >
          <Plus aria-hidden />
          Add Variable
        </AppButton>
      ) : null}
    </div>
  );

  const sections: ApSettingsRenderedSection[] = [];

  if (!environmentFocus) {
    if (replicasSliderParts != null) {
      sections.push({
        actions: quotaActions,
        content: (
          <ReplicaStrategyContent
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
        ),
        id: "replica-strategy",
        title: "Replica Strategy",
      });
    }

    sections.push({
      actions: replicasSliderParts == null ? quotaActions : undefined,
      content: (
        <>
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
        </>
      ),
      id: "cpu-memory",
      title: "CPU / Memory",
    });

    if (showImageSection) {
      sections.push({
        content: (
          <ImageSettingsContent
            imageInputId={imageInputId}
            onBlur={handleImageBlur}
            onChange={handleImageChange}
            readOnly={readOnly}
            value={displayImage}
          />
        ),
        icon: SquarePen,
        id: "image",
        title: "Image",
      });
    }

    sections.push({
      content: (
        <LaunchCommandSettingsContent
          args={settingsDraft.args ?? []}
          command={settingsDraft.command ?? []}
          onArgsChange={(value) =>
            setDraftArgs(normalizeCommandDraftLines(value))
          }
          onCommandChange={(value) =>
            setDraftCommand(normalizeCommandDraftLines(value))
          }
          readOnly={readOnly}
        />
      ),
      icon: Terminal,
      id: "launch-command",
      title: "Launch Command",
    });

    sections.push({
      content: (
        <ConfigMapSettingsContent
          configMapKeys={configMapDraftKeys}
          configMaps={settingsDraft.configMaps ?? []}
          expandedKeys={[...expandedConfigKeys]}
          onAdd={handleAddConfigMapRow}
          onCancel={handleCancelConfigMapRow}
          onDelete={handleDeleteConfigMapRow}
          onEdit={handleEditConfigMapRow}
          onSave={handleSaveConfigMapRow}
          onUpdate={handleUpdateConfigMapRow}
          readOnly={readOnly}
          submitBlocked={configSubmitBlocked}
        />
      ),
      icon: SquarePen,
      id: "config-files",
      title: "Configuration Files",
    });

    if (workloadKind === "statefulset" || draftStorage.length > 0) {
      sections.push({
        content: (
          <StorageSettingsContent
            currentStorage={initialSettingsDraft.storage ?? []}
            onUpdate={handleUpdateStorageRow}
            readOnly={readOnly}
            storage={settingsDraft.storage ?? []}
            storageKeys={storageDraftKeys}
          />
        ),
        icon: HardDrive,
        id: "storage",
        title: "Storage",
      });
    }
  }

  sections.push({
    content: (
      <>
        {envEditorControls}
        <div className="flex min-w-0 flex-col gap-2">
          {readOnly ? (
            <ReadOnlyEnvRows env={env} />
          ) : (
            <EditableEnvRows
              copiedValueIndex={copiedEnvValueIndex}
              dbDsnReferenceSources={dbDsnReferenceSources}
              envDirty={envDirty}
              envDraft={envDraft}
              envErrorsByIndex={envErrorsByIndex}
              envRawSourceDiagnostics={envRawSourceParse.diagnostics}
              envRawSourceDraft={envRawSourceDraft}
              envRowKeys={envDraftKeys}
              envTokenDiagnostics={envTokenDiagnostics}
              envValidation={envValidation}
              expandedKeys={[...expandedEnvKeys]}
              mode={envEditorMode}
              onCancelRow={handleCancelEnvRow}
              onCopyResolvedValue={copyResolvedEnvValue}
              onDeleteRow={handleDeleteEnvRow}
              onEditRow={editEnvRow}
              onRawSourceChange={handleRawSourceChange}
              onRevealResolvedValue={revealResolvedEnvValue}
              onSaveRow={handleSaveEnvRow}
              onUpdateRow={handleUpdateEnvRow}
              resolvedValuesAvailable={resolvedEnvValuesAvailable}
              revealedValues={revealedEnvValues}
              savedRows={committedEnvRows}
              submitBlocked={envSubmitBlocked}
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
      </>
    ),
    icon: SquarePen,
    id: "environment",
    title: "Environment Variables",
  });

  if (!environmentFocus && networkForRender != null) {
    sections.push({
      content: (
        <NetworkSettingsSection
          controller={networkController}
          onCustomDomainCnameVerify={onCustomDomainCnameVerify}
          platformAddressDraftContext={networkPlatformAddressDraftContext}
          publicAddressReadiness={publicAddressReadiness}
          readOnly={readOnly}
        />
      ),
      icon: Network,
      id: "network",
      title: "Network",
    });
  }

  return {
    footer: settingsCommitMode ? (
      <ApSettingsDraftFooter
        canSave={canSaveSettings}
        conflictMessage={settingsBackingState.submitConflictMessage}
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
    ) : null,
    leaveGuard,
    sections,
  };
}
