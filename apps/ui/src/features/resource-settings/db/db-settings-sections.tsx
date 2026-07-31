"use client";

import {
  useDbConnectionStringResolver,
  useDbSettingsOperations,
} from "@workspace/api/hooks";
import { CanvasNode } from "@workspace/ui/components/canvas-node/canvas-node";
import { DatabaseEngineIcon } from "@workspace/ui/components/database-engine-icon";
import {
  DatabaseConnectionRow,
  type DatabaseNodeConnection,
  type DatabaseNodePublicConnection,
  getDatabaseNodeConnectionKey,
} from "@workspace/ui/components/database-node/database-node";
import {
  ResourceSettingsDraftFooter,
  ResourceSettingsInset,
  ResourceSettingsSection,
} from "@workspace/ui/components/resource-settings/resource-settings";
import { SettingsSlider } from "@workspace/ui/components/settings-slider/settings-slider";
import { SidePaneFooter } from "@workspace/ui/components/side-pane";
import { Switch } from "@workspace/ui/components/switch";
import {
  Cpu,
  HardDrive,
  type LucideIcon,
  MemoryStick,
  Network,
  Settings2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
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
} from "@/features/resource-settings/ap/lib/settings-draft-backing";
import {
  classifyPendingSettingsEntry,
  getBrowserPendingSettingsStore,
  type PendingSettingsOwnerIdentity,
  type PendingSettingsUpdateEntry,
  usePendingSettingsEntries,
} from "@/features/resource-settings/pending-settings-updates";
import type {
  SettingsLeaveGuardHandle,
  SettingsLeaveGuardRegistration,
} from "@/features/resource-settings/settings-leave-guard";
import {
  getBrowserSettingsSubmissionStore,
  latestRejectedSettingsSubmission,
  type SettingsSubmissionDomainUpdate,
  useSettingsSubmissionEntries,
} from "@/features/resource-settings/settings-submissions";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { copyDbConnectionValue } from "@/lib/secret-reveal";
import { toastErrorDetail } from "@/lib/toast-utils";
import { type RevealedRow, useRevealedRow } from "@/lib/use-revealed-row";
import {
  applyDbPendingTargets,
  type DbPendingSettingsTarget,
  type DbPendingSettingsTargets,
  dbPendingTargetForDomain,
  dbPendingTargetsEqual,
  dbPendingTargetsForDirtyDomains,
} from "./db-pending-settings";
import {
  buildDbSettingsPatch,
  DATABASE_SETTINGS_DRAFT_DOMAINS,
  type DatabaseSettingsDraft,
  type DatabaseSettingsDraftDomain,
  type DatabaseSettingsPatch,
  DB_SETTINGS_CPU_LIMIT_CORES,
  DB_SETTINGS_MEMORY_LIMIT_GIB,
  DB_SETTINGS_REPLICA_COUNT,
  DB_SETTINGS_STORAGE_GIB,
  dbSettingsDraftDomainIsDirty,
  dbSettingsDraftFromNodeData,
  dbSettingsDraftIsDirty,
  mergeDbSettingsDraftDomains,
  normalizeDbSettingsCpuLimitCores,
  normalizeDbSettingsMemoryLimitGi,
  normalizeDbSettingsReplicas,
  normalizeDbSettingsStorageGi,
} from "./db-settings-draft";
import type { DbSettingsData } from "./db-settings-types";

const DB_SETTINGS_SUBMIT_CONFLICT_MESSAGE =
  "Database configuration changed since you started editing.";
const DB_SETTINGS_DRAFT_DOMAIN_SET = new Set<string>(
  DATABASE_SETTINGS_DRAFT_DOMAINS
);

function isDatabaseSettingsDraftDomain(
  domain: string
): domain is DatabaseSettingsDraftDomain {
  return DB_SETTINGS_DRAFT_DOMAIN_SET.has(domain);
}

function dbSettingsSubmissionTargets(
  entries: readonly { domain: string; status: string; target: unknown }[]
): DbPendingSettingsTargets {
  const targets: DbPendingSettingsTargets = {};
  for (const entry of entries) {
    if (
      entry.status !== "submitting" ||
      !isDatabaseSettingsDraftDomain(entry.domain)
    ) {
      continue;
    }
    targets[entry.domain] = entry.target as never;
  }
  return targets;
}

function dbSettingsSubmissionUpdates(
  base: DatabaseSettingsDraft,
  draft: DatabaseSettingsDraft
): SettingsSubmissionDomainUpdate<DbPendingSettingsTarget>[] {
  const targets = dbPendingTargetsForDirtyDomains(base, draft);
  const updates: SettingsSubmissionDomainUpdate<DbPendingSettingsTarget>[] = [];
  for (const domain of DATABASE_SETTINGS_DRAFT_DOMAINS) {
    if (!Object.hasOwn(targets, domain)) {
      continue;
    }
    updates.push({
      domain,
      submittedAgainst: dbPendingTargetForDomain(domain, base),
      target: targets[domain] as DbPendingSettingsTarget,
    });
  }
  return updates;
}

function dbAcceptedPendingTargets(
  base: DatabaseSettingsDraft,
  entries: readonly PendingSettingsUpdateEntry[]
): {
  reconciledDomains: readonly DatabaseSettingsDraftDomain[];
  targets: DbPendingSettingsTargets;
} {
  const reconciledDomains: DatabaseSettingsDraftDomain[] = [];
  const targets: DbPendingSettingsTargets = {};
  for (const entry of entries) {
    if (!isDatabaseSettingsDraftDomain(entry.domain)) {
      continue;
    }
    const domain = entry.domain;
    const classification = classifyPendingSettingsEntry(
      entry as PendingSettingsUpdateEntry<DbPendingSettingsTarget>,
      {
        equals: (left, right) => dbPendingTargetsEqual(domain, left, right),
        observed: dbPendingTargetForDomain(domain, base),
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

interface DatabaseSettingsPaneProps {
  data: DbSettingsData;
  kubeconfig?: string;
  onClose: () => void;
  onSettingsLeaveGuardChange?: SettingsLeaveGuardRegistration;
  onUpdated?: () => Promise<unknown>;
}

export interface DatabaseSettingsSectionsProps {
  data: DbSettingsData;
  editable?: boolean;
  /**
   * Enables the explicit reveal/copy actions on connection rows: rows display
   * credential-free DB Connection Templates, and the complete DB Connection
   * DSN is fetched on demand under this kubeconfig (ADR-0053).
   */
  kubeconfig?: string;
  onSubmitPatch?: (patch: DatabaseSettingsPatch) => Promise<unknown> | unknown;
  onUpdated?: () => Promise<unknown>;
  routingDomain?: string;
  submissionOwner?: PendingSettingsOwnerIdentity;
  updating?: boolean;
}

interface DatabaseSettingsPaneContentProps
  extends DatabaseSettingsSectionsProps {
  onSettingsLeaveGuardChange?: SettingsLeaveGuardRegistration;
  renderShell?: boolean;
}

export interface DatabaseSettingsRenderedSection {
  actions?: ReactNode;
  chromeless?: boolean;
  content: ReactNode;
  icon?: LucideIcon;
  id: string;
  title: string;
}

export interface DatabaseSettingsSectionsModel {
  footer?: ReactNode;
  leaveGuard?: SettingsLeaveGuardHandle | null;
  sections: DatabaseSettingsRenderedSection[];
}

function databaseHeaderSubtitle({
  displayEngine,
  formattedVersion,
}: DbSettingsData["states"]) {
  return `Database ${displayEngine}${formattedVersion ? ` ${formattedVersion}` : ""}`;
}

function cpuValueSuffix(value: number) {
  return value === 1 ? " Core" : " Cores";
}

function formatGiValue(value: number) {
  if (value < 1) {
    return `${Math.round(value * 1024)} Mi`;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} Gi`;
}

function giDisplayValue(value: number) {
  return value < 1 ? Math.round(value * 1024) : value;
}

function giValueSuffix(value: number) {
  return value < 1 ? " Mi" : " Gi";
}

function displayConnectionLabel(connection: DatabaseNodeConnection) {
  if (connection.kind === "private") {
    return "Private Connection";
  }
  return "Public Connection";
}

function shouldShowConnectionAddress(connection: DatabaseNodeConnection) {
  return connection.kind === "private" || connection.kind === "public";
}

type DatabaseSettingsConnectionCopyHandler = (
  connection: DatabaseNodeConnection
) => Promise<void>;

type DatabaseSettingsConnectionRevealHandler = (
  connection: DatabaseNodeConnection,
  rowKey: string
) => void;

function DatabaseSettingsConnectionAddressRow({
  connection,
  controlsDisabled,
  index,
  onCopyConnection,
  onPublicConnectionChange,
  onRevealConnection,
  publicConnectionEnabled,
  revealAvailable,
  revealedValue,
}: {
  connection: DatabaseNodeConnection;
  controlsDisabled: boolean;
  index: number;
  onCopyConnection: DatabaseSettingsConnectionCopyHandler;
  onPublicConnectionChange: (nextEnabled: boolean) => void;
  onRevealConnection: DatabaseSettingsConnectionRevealHandler;
  publicConnectionEnabled: boolean;
  revealAvailable: boolean;
  revealedValue?: string;
}) {
  const rowKey = getDatabaseNodeConnectionKey(connection, index);

  return (
    <DatabaseConnectionRow
      connection={connection}
      label={displayConnectionLabel(connection)}
      onCopy={() => onCopyConnection(connection)}
      onToggleReveal={
        revealAvailable
          ? () => onRevealConnection(connection, rowKey)
          : undefined
      }
      publicAccessEnabled={
        connection.kind === "public" ? publicConnectionEnabled : undefined
      }
      publicSwitch={
        connection.kind === "public" ? (
          <DatabaseSettingsPublicConnectionSwitch
            connection={connection}
            controlsDisabled={controlsDisabled}
            onCheckedChange={onPublicConnectionChange}
            publicConnectionEnabled={publicConnectionEnabled}
          />
        ) : undefined
      }
      revealedValue={revealedValue}
      rowKey={rowKey}
      variant="settings"
    />
  );
}

function DatabaseSettingsPublicConnectionSwitch({
  connection,
  controlsDisabled,
  onCheckedChange,
  publicConnectionEnabled,
}: {
  connection: DatabaseNodePublicConnection;
  controlsDisabled: boolean;
  onCheckedChange: (nextEnabled: boolean) => void;
  publicConnectionEnabled: boolean;
}) {
  return (
    <Switch
      aria-label="Public connection"
      checked={publicConnectionEnabled}
      className="shrink-0"
      disabled={controlsDisabled || connection.publicAccess.loading === true}
      onCheckedChange={onCheckedChange}
      size="lg"
      variant="brand"
    />
  );
}

function DatabaseSettingsConnectionAddressList({
  connections,
  controlsDisabled,
  onCopyConnection,
  onPublicConnectionChange,
  onRevealConnection,
  publicConnectionEnabled,
  revealAvailable,
  revealedRow,
}: {
  connections: readonly DatabaseNodeConnection[];
  controlsDisabled: boolean;
  onCopyConnection: DatabaseSettingsConnectionCopyHandler;
  onPublicConnectionChange: (nextEnabled: boolean) => void;
  onRevealConnection: DatabaseSettingsConnectionRevealHandler;
  publicConnectionEnabled: boolean;
  revealAvailable: boolean;
  revealedRow: RevealedRow | null;
}) {
  const visibleConnections = connections.filter(shouldShowConnectionAddress);

  if (visibleConnections.length === 0) {
    return (
      <div
        className="flex min-h-11 min-w-0 items-center rounded-lg bg-white/5 px-2.5 text-muted-foreground text-sm leading-5"
        data-slot="database-settings-connection-address-empty"
      >
        No connection addresses
      </div>
    );
  }

  return (
    <CanvasNode.CopyFeedbackScope>
      <div
        className="flex min-w-0 flex-col gap-2"
        data-slot="database-settings-connection-address-list"
      >
        {visibleConnections.map((connection, index) => {
          const rowKey = getDatabaseNodeConnectionKey(connection, index);
          return (
            <DatabaseSettingsConnectionAddressRow
              connection={connection}
              controlsDisabled={controlsDisabled}
              index={index}
              key={rowKey}
              onCopyConnection={onCopyConnection}
              onPublicConnectionChange={onPublicConnectionChange}
              onRevealConnection={onRevealConnection}
              publicConnectionEnabled={publicConnectionEnabled}
              revealAvailable={revealAvailable}
              revealedValue={
                revealedRow?.key === rowKey ? revealedRow.value : undefined
              }
            />
          );
        })}
      </div>
    </CanvasNode.CopyFeedbackScope>
  );
}

function DatabaseSettingsFooter({
  canUpdate,
  conflictMessage,
  dirty,
  onCancel,
  onKeepEditing,
  onReload,
  onUpdate,
  saveFailureMessage,
  updating,
}: {
  canUpdate: boolean;
  conflictMessage?: string | null;
  dirty: boolean;
  onCancel: () => void;
  onKeepEditing: () => void;
  onReload: () => void;
  onUpdate: () => void;
  saveFailureMessage: string | null;
  updating: boolean;
}) {
  return (
    <ResourceSettingsDraftFooter
      cancelAriaLabel="Discard database configuration changes"
      canSubmit={canUpdate}
      className="w-full"
      conflictMessage={conflictMessage}
      dirty={dirty}
      onCancel={onCancel}
      onKeepEditing={onKeepEditing}
      onReload={onReload}
      onSubmit={onUpdate}
      pending={updating}
      saveFailureMessage={saveFailureMessage}
      submitAriaLabel="Update database settings"
    />
  );
}

function databaseSettingsBackingKey(
  identityKey: string,
  draft: DatabaseSettingsDraft
) {
  return JSON.stringify({ draft, identityKey });
}

export function DatabaseSettingsPane({
  data,
  kubeconfig,
  onSettingsLeaveGuardChange,
  onUpdated,
}: DatabaseSettingsPaneProps) {
  const readOnly = data.settingsAccess?.readOnly === true;
  const routingDomain = useMemo(
    () => (readOnly ? "" : routingDomainFromKubeconfig(kubeconfig ?? "")),
    [kubeconfig, readOnly]
  );
  const { authReady, isUpdating, updateSettings } = useDbSettingsOperations({
    kubeconfig: readOnly ? undefined : kubeconfig,
  });

  const workload = data.workload;
  const updating = isUpdating(workload);
  const handleSubmitPatch = useCallback(
    (patch: DatabaseSettingsPatch) => updateSettings(workload, patch),
    [updateSettings, workload]
  );

  return (
    <DatabaseSettingsPaneContent
      data={data}
      editable={!readOnly && authReady}
      kubeconfig={readOnly ? undefined : kubeconfig}
      onSettingsLeaveGuardChange={onSettingsLeaveGuardChange}
      onSubmitPatch={!readOnly && authReady ? handleSubmitPatch : undefined}
      onUpdated={onUpdated}
      routingDomain={routingDomain}
      updating={updating}
    />
  );
}

export function useDatabaseSettingsSections({
  data,
  editable = true,
  kubeconfig,
  onSubmitPatch,
  onUpdated,
  routingDomain,
  submissionOwner,
  updating = false,
}: DatabaseSettingsSectionsProps): DatabaseSettingsSectionsModel {
  const readOnly = data.settingsAccess?.readOnly === true;
  const canEdit = editable && !readOnly;
  const desired = data.desired;
  const workloadName = data.workload.name.trim();
  const workloadNamespace = data.workload.namespace.trim();
  const workload = data.workload;
  const { authReady: revealAvailable, resolveConnectionString } =
    useDbConnectionStringResolver({
      kubeconfig: readOnly ? undefined : kubeconfig,
    });
  const { revealedRow, toggleRevealedRow } = useRevealedRow();
  const revealConnection = useCallback<DatabaseSettingsConnectionRevealHandler>(
    (connection, rowKey) => {
      toggleRevealedRow(rowKey, () =>
        resolveConnectionString(workload, connection.kind)
      ).catch(() => undefined);
    },
    [resolveConnectionString, toggleRevealedRow, workload]
  );
  const copyConnection = useCallback<DatabaseSettingsConnectionCopyHandler>(
    (connection) =>
      copyDbConnectionValue({
        placeholderValue: connection.value ?? "",
        resolveAvailable: revealAvailable,
        resolveValue: () => resolveConnectionString(workload, connection.kind),
      }),
    [resolveConnectionString, revealAvailable, workload]
  );
  const desiredCpuLimit = desired?.cpuLimit;
  const desiredExposeNodePort = desired?.exposeNodePort === true;
  const desiredMemoryLimit = desired?.memoryLimit;
  const desiredReplicas = desired?.replicas;
  const desiredStorageSize = desired?.storageSize;
  const identityKey = `${workloadNamespace}/${workloadName}`;
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
  const acceptedPendingEntries = usePendingSettingsEntries(
    submissionOwner,
    pendingSettingsStore
  );
  const observedState = useMemo(() => {
    const draft = dbSettingsDraftFromNodeData({
      desired: {
        ...(desiredCpuLimit === undefined ? {} : { cpuLimit: desiredCpuLimit }),
        exposeNodePort: desiredExposeNodePort,
        ...(desiredMemoryLimit === undefined
          ? {}
          : { memoryLimit: desiredMemoryLimit }),
        ...(desiredReplicas === undefined ? {} : { replicas: desiredReplicas }),
        ...(desiredStorageSize === undefined
          ? {}
          : { storageSize: desiredStorageSize }),
      },
    });

    return {
      backingKey: databaseSettingsBackingKey(identityKey, draft),
      draft,
      identityKey,
    };
  }, [
    desiredCpuLimit,
    desiredExposeNodePort,
    desiredMemoryLimit,
    desiredReplicas,
    desiredStorageSize,
    identityKey,
  ]);
  const activeSubmissionTargets = useMemo(
    () => dbSettingsSubmissionTargets(submissionEntries),
    [submissionEntries]
  );
  const acceptedPendingOverlay = useMemo(
    () => dbAcceptedPendingTargets(observedState.draft, acceptedPendingEntries),
    [acceptedPendingEntries, observedState.draft]
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
  const pendingState = useMemo(() => {
    const draft = applyDbPendingTargets(
      observedState.draft,
      acceptedPendingOverlay.targets
    );
    return {
      backingKey: databaseSettingsBackingKey(observedState.identityKey, draft),
      draft,
      identityKey: observedState.identityKey,
    };
  }, [acceptedPendingOverlay.targets, observedState]);
  const originalState = useMemo(() => {
    const draft = applyDbPendingTargets(
      pendingState.draft,
      activeSubmissionTargets
    );
    return {
      backingKey: databaseSettingsBackingKey(pendingState.identityKey, draft),
      draft,
      identityKey: pendingState.identityKey,
    };
  }, [activeSubmissionTargets, pendingState]);
  const [draft, setDraft] = useState<DatabaseSettingsDraft>(
    () => originalState.draft
  );
  const [backingState, setBackingState] = useState(() =>
    createSettingsDraftBackingState(
      originalState.draft,
      originalState.backingKey,
      originalState.identityKey
    )
  );
  const original = backingState.base;
  const latestDraftRef = useRef(draft);
  const latestBackingStateRef = useRef(backingState);
  useEffect(() => {
    latestDraftRef.current = draft;
    latestBackingStateRef.current = backingState;
  }, [backingState, draft]);
  const rejectedSettingsSubmission = useMemo(
    () =>
      latestRejectedSettingsSubmission<DatabaseSettingsDraft>(
        submissionEntries
      ),
    [submissionEntries]
  );
  const canApplyRejectedSettingsSubmission =
    rejectedSettingsSubmission != null &&
    !dbSettingsDraftIsDirty(backingState.base, draft);
  const appliedRejectedSubmissionId = useRef<string | null>(null);

  useEffect(() => {
    if (
      !(canEdit && canApplyRejectedSettingsSubmission) ||
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
    setDraft(rejectedSettingsSubmission.draft);
    setBackingState({
      ...createSettingsDraftBackingState(
        rejectedSettingsSubmission.baseDraft,
        databaseSettingsBackingKey(
          originalState.identityKey,
          rejectedSettingsSubmission.baseDraft
        ),
        originalState.identityKey
      ),
      latest: originalState.draft,
      latestKey: originalState.backingKey,
      saveFailureMessage: settingsDraftSaveFailureMessage(
        rejectedSettingsSubmission.errorMessage == null
          ? new Error("Update failed.")
          : new Error(rejectedSettingsSubmission.errorMessage),
        "Could not submit database settings."
      ),
    });
    submissionStore.clear({
      domains: rejectedSettingsSubmission.domains,
      owner: submissionOwner,
      statuses: ["rejected"],
    });
  }, [
    canApplyRejectedSettingsSubmission,
    canEdit,
    originalState,
    rejectedSettingsSubmission,
    submissionOwner,
    submissionStore,
  ]);

  useEffect(() => {
    if (canApplyRejectedSettingsSubmission) {
      return;
    }
    const synced = syncSettingsDraftBackingState(backingState, {
      backing: originalState.draft,
      backingKey: originalState.backingKey,
      draft,
      identityKey: originalState.identityKey,
      isDirty: dbSettingsDraftIsDirty,
    });
    if (synced.state === backingState && synced.draft === undefined) {
      return;
    }
    applySettingsDraftBackingResult(synced, {
      draft: setDraft,
      state: setBackingState,
    });
  }, [backingState, canApplyRejectedSettingsSubmission, draft, originalState]);

  const pendingPatch = useMemo(
    () =>
      buildDbSettingsPatch(original, draft, {
        metadata: data.metadata,
        routingDomain,
      }),
    [data.metadata, draft, original, routingDomain]
  );
  const dirtyDomains = useMemo(
    () =>
      DATABASE_SETTINGS_DRAFT_DOMAINS.filter((domain) =>
        dbSettingsDraftDomainIsDirty(domain, original, draft)
      ),
    [draft, original]
  );
  const submittingDomains = useMemo(
    () =>
      new Set(
        submissionEntries
          .filter((entry) => entry.status === "submitting")
          .map((entry) => entry.domain)
      ),
    [submissionEntries]
  );
  const hasOverlappingSubmittingDomain = dirtyDomains.some((domain) =>
    submittingDomains.has(domain)
  );
  const dirty = dirtyDomains.length > 0;
  const canUpdate =
    canEdit &&
    pendingPatch !== null &&
    !updating &&
    onSubmitPatch != null &&
    !hasOverlappingSubmittingDomain;
  const controlsDisabled = !canEdit || updating;

  const saveSettingsDraft = useCallback(() => {
    if (!canUpdate || pendingPatch === null || onSubmitPatch == null) {
      throw new Error("Database settings draft cannot be saved yet.");
    }
    const prepared = prepareSettingsDraftSubmit(backingState, {
      conflictMessage: DB_SETTINGS_SUBMIT_CONFLICT_MESSAGE,
      domains: DATABASE_SETTINGS_DRAFT_DOMAINS,
      draft,
      isDomainDirty: dbSettingsDraftDomainIsDirty,
      mergeDraft: mergeDbSettingsDraftDomains,
    });
    setBackingState(prepared.state);
    if (prepared.status === "conflict") {
      throw new Error(DB_SETTINGS_SUBMIT_CONFLICT_MESSAGE);
    }
    const patch = buildDbSettingsPatch(prepared.base, prepared.draft, {
      metadata: data.metadata,
      routingDomain,
    });
    if (patch === null) {
      setDraft(prepared.draft);
      setBackingState((current) =>
        commitSettingsDraftBackingState(
          current,
          prepared.draft,
          databaseSettingsBackingKey(originalState.identityKey, prepared.draft)
        )
      );
      return;
    }
    const submissionUpdates = dbSettingsSubmissionUpdates(
      prepared.base,
      prepared.draft
    );
    const submissionStart =
      submissionOwner == null || submissionStore == null
        ? { entries: [], status: "started" as const }
        : submissionStore.start({
            baseDraft: prepared.base,
            draft: prepared.draft,
            owner: submissionOwner,
            updates: submissionUpdates,
          });
    if (submissionStart.status === "blocked") {
      throw new Error("Settings update is already submitting.");
    }
    const startedSubmissionEntries = submissionStart.entries;
    setBackingState((current) => ({ ...current, saveFailureMessage: null }));
    setBackingState((current) =>
      commitSettingsDraftBackingState(
        current,
        prepared.draft,
        databaseSettingsBackingKey(originalState.identityKey, prepared.draft)
      )
    );
    setDraft(prepared.draft);

    const toastId = toast.loading("Submitting database settings update...");
    Promise.resolve()
      .then(() => onSubmitPatch(patch))
      .then(() => {
        if (submissionOwner != null && submissionStore != null) {
          submissionStore.accept({
            entries: startedSubmissionEntries,
            owner: submissionOwner,
            pendingStore: pendingSettingsStore,
          });
        }
        toast.success("Update accepted. Applying changes.", { id: toastId });
        onUpdated?.().catch(() => undefined);
      })
      .catch((error) => {
        if (submissionOwner != null && submissionStore != null) {
          submissionStore.reject({
            entries: startedSubmissionEntries,
            error,
            owner: submissionOwner,
          });
        } else {
          setBackingState(
            failSettingsDraftSave(
              prepared.state,
              error,
              "Could not submit database settings."
            )
          );
          setDraft(prepared.draft);
        }
        toastErrorDetail(
          "Could not submit database settings.",
          settingsDraftSaveFailureMessage(
            error,
            "Could not submit database settings."
          ),
          {
            action: {
              label: "Back to draft",
              onClick: () => {
                if (
                  dbSettingsDraftIsDirty(
                    latestBackingStateRef.current.base,
                    latestDraftRef.current
                  )
                ) {
                  return;
                }
                setBackingState(
                  failSettingsDraftSave(
                    prepared.state,
                    error,
                    "Could not submit database settings."
                  )
                );
                setDraft(prepared.draft);
              },
            },
            id: toastId,
          }
        );
      });
  }, [
    backingState,
    canUpdate,
    data.metadata,
    draft,
    onSubmitPatch,
    onUpdated,
    originalState.identityKey,
    pendingSettingsStore,
    pendingPatch,
    routingDomain,
    submissionOwner,
    submissionStore,
  ]);

  const handleUpdate = useCallback(() => {
    try {
      saveSettingsDraft();
    } catch {
      /* Keep the user on the settings draft; panel state already shows failure. */
    }
  }, [saveSettingsDraft]);

  const handleReloadDraft = useCallback(() => {
    applySettingsDraftBackingResult(
      reloadSettingsDraftBackingState(backingState),
      {
        draft: setDraft,
        state: setBackingState,
      }
    );
  }, [backingState]);

  const handleKeepEditingDraft = useCallback(() => {
    setBackingState((current) => keepEditingSettingsDraftBackingState(current));
  }, []);

  const leaveGuard: SettingsLeaveGuardHandle | null =
    canEdit && dirty
      ? {
          canSave: canUpdate,
          dirty: true,
          discard: handleReloadDraft,
          save: saveSettingsDraft,
          scope: "database",
        }
      : null;

  return {
    footer: readOnly ? null : (
      <DatabaseSettingsFooter
        canUpdate={canUpdate}
        conflictMessage={backingState.submitConflictMessage}
        dirty={dirty}
        onCancel={handleReloadDraft}
        onKeepEditing={handleKeepEditingDraft}
        onReload={handleReloadDraft}
        onUpdate={handleUpdate}
        saveFailureMessage={backingState.saveFailureMessage}
        updating={updating}
      />
    ),
    leaveGuard,
    sections: [
      {
        content: (
          <>
            <ResourceSettingsInset>
              <SettingsSlider
                ariaLabel="Database replica count"
                disabled={controlsDisabled}
                label="Number of Replicas"
                max={DB_SETTINGS_REPLICA_COUNT.max}
                maxDecimals={0}
                min={DB_SETTINGS_REPLICA_COUNT.min}
                onValueChange={(value) => {
                  setDraft((current) => ({
                    ...current,
                    replicas: normalizeDbSettingsReplicas(value),
                  }));
                }}
                step={DB_SETTINGS_REPLICA_COUNT.step}
                value={draft.replicas}
              />
            </ResourceSettingsInset>
            <ResourceSettingsInset>
              <SettingsSlider
                ariaLabel="Database CPU limit in cores"
                disabled={controlsDisabled}
                icon={Cpu}
                label="CPU"
                max={DB_SETTINGS_CPU_LIMIT_CORES.max}
                maxDecimals={2}
                min={DB_SETTINGS_CPU_LIMIT_CORES.min}
                onValueChange={(value) => {
                  setDraft((current) => ({
                    ...current,
                    cpuLimitCores: normalizeDbSettingsCpuLimitCores(value),
                  }));
                }}
                step={DB_SETTINGS_CPU_LIMIT_CORES.step}
                value={draft.cpuLimitCores}
                valueSuffix={cpuValueSuffix}
              />
            </ResourceSettingsInset>
            <ResourceSettingsInset>
              <SettingsSlider
                ariaLabel="Database memory limit in Gi"
                disabled={controlsDisabled}
                displayValue={giDisplayValue(draft.memoryLimitGi)}
                formatBound={formatGiValue}
                icon={MemoryStick}
                label="Memory"
                max={DB_SETTINGS_MEMORY_LIMIT_GIB.max}
                maxDecimals={1}
                min={DB_SETTINGS_MEMORY_LIMIT_GIB.min}
                onValueChange={(value) => {
                  setDraft((current) => ({
                    ...current,
                    memoryLimitGi: normalizeDbSettingsMemoryLimitGi(value),
                  }));
                }}
                step={DB_SETTINGS_MEMORY_LIMIT_GIB.step}
                value={draft.memoryLimitGi}
                valueSuffix={giValueSuffix(draft.memoryLimitGi)}
              />
            </ResourceSettingsInset>
          </>
        ),
        icon: Settings2,
        id: "resources",
        title: "Replicas & Resources",
      },
      {
        content: (
          <ResourceSettingsInset>
            <SettingsSlider
              ariaLabel="Database storage size in Gi"
              disabled={controlsDisabled}
              formatBound={formatGiValue}
              icon={HardDrive}
              label="Storage"
              max={DB_SETTINGS_STORAGE_GIB.max}
              maxDecimals={0}
              min={DB_SETTINGS_STORAGE_GIB.min}
              onValueChange={(value) => {
                setDraft((current) => ({
                  ...current,
                  storageSizeGi: normalizeDbSettingsStorageGi(value),
                }));
              }}
              step={DB_SETTINGS_STORAGE_GIB.step}
              value={draft.storageSizeGi}
              valueSuffix=" Gi"
            />
          </ResourceSettingsInset>
        ),
        icon: HardDrive,
        id: "storage",
        title: "Storage",
      },
      {
        content: (
          <DatabaseSettingsConnectionAddressList
            connections={data.connections}
            controlsDisabled={controlsDisabled}
            onCopyConnection={copyConnection}
            onPublicConnectionChange={(nextEnabled) => {
              setDraft((current) => ({
                ...current,
                exposeNodePort: nextEnabled,
              }));
            }}
            onRevealConnection={revealConnection}
            publicConnectionEnabled={draft.exposeNodePort}
            revealAvailable={revealAvailable}
            revealedRow={revealedRow}
          />
        ),
        icon: Network,
        id: "connection-address",
        title: "Connection Address",
      },
    ],
  };
}

export function DatabaseSettingsPaneContent({
  data,
  editable = true,
  kubeconfig,
  renderShell = true,
  onSettingsLeaveGuardChange,
  onSubmitPatch,
  onUpdated,
  routingDomain,
  submissionOwner,
  updating = false,
}: DatabaseSettingsPaneContentProps) {
  const subtitle = databaseHeaderSubtitle(data.states);
  const model = useDatabaseSettingsSections({
    data,
    editable,
    kubeconfig,
    onSubmitPatch,
    onUpdated,
    routingDomain,
    submissionOwner,
    updating,
  });

  useEffect(() => {
    if (onSettingsLeaveGuardChange == null) {
      return;
    }
    onSettingsLeaveGuardChange(model.leaveGuard ?? null);
    return () => {
      onSettingsLeaveGuardChange(null);
    };
  }, [model.leaveGuard, onSettingsLeaveGuardChange]);

  const content = (
    <>
      {model.sections.map((section) =>
        section.chromeless ? (
          <div data-settings-section={section.id} key={section.id}>
            {section.content}
          </div>
        ) : (
          <ResourceSettingsSection
            actions={section.actions}
            icon={section.icon}
            key={section.id}
            title={section.title}
          >
            {section.content}
          </ResourceSettingsSection>
        )
      )}
      {model.footer == null ? null : (
        <SidePaneFooter>{model.footer}</SidePaneFooter>
      )}
    </>
  );

  if (!renderShell) {
    return content;
  }

  return (
    <section aria-label={data.states.name} data-slot="database-settings-pane">
      <header className="sr-only">
        <DatabaseEngineIcon
          className="size-4 shrink-0 object-contain text-blue-400"
          engine={data.states.engineKey}
          iconUrl={data.states.iconUrl}
        />
        <span>{subtitle}</span>
      </header>
      {content}
    </section>
  );
}
