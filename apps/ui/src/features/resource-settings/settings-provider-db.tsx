"use client";

import {
  useBrainProductResource,
  useDbSettingsOperations,
} from "@workspace/api/hooks";
import { DatabaseEngineIcon } from "@workspace/ui/components/database-engine-icon";
import { useCallback, useEffect, useMemo } from "react";
import type { ProjectSideSurfaceEntry } from "@/features/panes/surface-state";
import type { ProjectDbTarget } from "@/features/panes/target-identity";
import { resolveResourceDisplayName } from "@/features/resource-display-name/resource-display-name";
import { k8sGetClaimBody } from "@/features/resource-settings/ap/k8s/claim-mapper";
import { dbResourceToSettingsData } from "@/features/resource-settings/db/db-settings-resource";
import { useDatabaseSettingsSections } from "@/features/resource-settings/db/db-settings-sections";
import type { DbSettingsData } from "@/features/resource-settings/db/db-settings-types";
import { settingsOwnerIdentity } from "@/features/resource-settings/settings-owner-identity";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { asRecord } from "@/lib/unknown-record";
import { ResourceDisplayNameTitle } from "./resource-display-name-title";
import { SettingsSections } from "./settings-sections";
import type {
  SettingsProviderProps,
  SettingsViewModel,
} from "./settings-types";
import { useResourceDisplayNameRename } from "./use-resource-display-name-rename";

const DB_SETTINGS_FULL_VIEW = "full";

/**
 * Defense in depth: only a claim whose metadata matches the target exactly
 * (name and namespace; both must be present) may back the pane. A claim that
 * belongs to any other DB — or one without identifying metadata — is ignored,
 * so the pane falls back to its loading state instead of rendering foreign
 * data. The card-refresh bug itself is fixed by revalidation (see the
 * `dedupingInterval` option below), not by this guard.
 */
function dbClaimBodyForTarget(
  data: ReturnType<typeof useBrainProductResource>["data"],
  target: ProjectDbTarget | null
): Record<string, unknown> | undefined {
  if (target == null) {
    return undefined;
  }
  const resource = k8sGetClaimBody(data);
  if (resource == null) {
    return undefined;
  }
  const metadata = asRecord(resource.metadata);
  const name = typeof metadata?.name === "string" ? metadata.name : undefined;
  const namespace =
    typeof metadata?.namespace === "string" ? metadata.namespace : undefined;
  if (name !== target.name || namespace !== target.namespace) {
    return undefined;
  }
  return resource;
}

export function dbSettingsDataFromExactResource(
  data: ReturnType<typeof useBrainProductResource>["data"],
  target: ProjectDbTarget | null
): DbSettingsData | null {
  if (target == null) {
    return null;
  }
  const resource = dbClaimBodyForTarget(data, target);
  return resource == null
    ? null
    : dbResourceToSettingsData(resource, {
        namespaceFallback: target.namespace,
      });
}

function resolvedDbSettingsView(view: string | undefined) {
  if (view == null || view.trim() === "" || view === DB_SETTINGS_FULL_VIEW) {
    return DB_SETTINGS_FULL_VIEW;
  }
  return DB_SETTINGS_FULL_VIEW;
}

function dbSettingsRepairEntry({
  resolvedView,
  target,
  view,
}: {
  resolvedView: string;
  target: ProjectDbTarget;
  view: string | undefined;
}): ProjectSideSurfaceEntry | undefined {
  if (view == null || view.trim() === "" || view === resolvedView) {
    return undefined;
  }
  return { kind: "settings", target };
}

export function DbSettingsProvider({
  kubeconfig,
  onModelChange,
  onRepairSideEntry,
  onUpdated,
  readModelHints,
  readOnly,
  target,
  view,
}: SettingsProviderProps) {
  const resolvedView = resolvedDbSettingsView(view);
  const dbTarget = target.kind === "DB" ? target : null;
  const dbResource = useBrainProductResource({
    // The pane retargets this hook in place as the user switches DB nodes.
    // Revisiting a node inside SWR's default 2s dedupe window would be a
    // cache hit with no revalidation, keeping the earlier claim's card
    // values on screen — disable the window so every revisit refetches.
    dedupingInterval: 0,
    kind: "DB",
    kubeconfig: dbTarget == null ? "" : (kubeconfig ?? ""),
    name: dbTarget?.name ?? "",
    namespace: dbTarget?.namespace ?? "",
  });
  const data = useMemo(
    () => dbSettingsDataFromExactResource(dbResource.data, dbTarget),
    [dbResource.data, dbTarget]
  );
  const settingsReadOnly = data?.settingsAccess?.readOnly === true;
  const effectiveReadOnly = readOnly || settingsReadOnly;
  const routingDomain = useMemo(
    () =>
      effectiveReadOnly ? "" : routingDomainFromKubeconfig(kubeconfig ?? ""),
    [effectiveReadOnly, kubeconfig]
  );
  const { authReady, isUpdating, updateSettings } = useDbSettingsOperations({
    kubeconfig: effectiveReadOnly ? undefined : kubeconfig,
  });
  const workload = data?.workload;
  const updating = workload == null ? false : isUpdating(workload);
  const resourceMetadata = asRecord(
    dbClaimBodyForTarget(dbResource.data, dbTarget)?.metadata
  );
  const displayName =
    dbTarget == null
      ? ""
      : resolveResourceDisplayName({
          annotations: asRecord(resourceMetadata?.annotations),
          kubernetesName: dbTarget.name,
        });
  const { onRenameResource, takenDisplayNames } = useResourceDisplayNameRename({
    kind: "DB",
    kubeconfig: kubeconfig ?? "",
    onUpdated,
    resourceDisplayNames: readModelHints?.resourceDisplayNames,
    revalidate: dbResource.mutate,
    target: dbTarget,
  });
  const canRename = data != null && !effectiveReadOnly && authReady;
  const handleSubmitPatch = useCallback(
    (patch: Parameters<typeof updateSettings>[1]) => {
      if (workload == null) {
        return undefined;
      }
      return updateSettings(workload, patch);
    },
    [updateSettings, workload]
  );
  const sectionsModel = useDatabaseSettingsSections({
    data:
      data ??
      ({
        connections: [],
        states: { displayEngine: "Database", name: target.name },
        workload: {
          name: target.name,
          namespace: target.namespace,
        },
      } satisfies DbSettingsData),
    editable: data != null && !effectiveReadOnly && authReady,
    kubeconfig: effectiveReadOnly ? undefined : kubeconfig,
    onSubmitPatch:
      data != null && !effectiveReadOnly && authReady
        ? handleSubmitPatch
        : undefined,
    onUpdated,
    routingDomain,
    submissionOwner: settingsOwnerIdentity({
      kubeconfig,
      target: dbTarget,
    }),
    updating,
  });

  useEffect(() => {
    if (target.kind !== "DB") {
      onRepairSideEntry?.(null);
      return;
    }
    const repairEntry = dbSettingsRepairEntry({
      resolvedView,
      target,
      view,
    });
    if (repairEntry !== undefined) {
      onRepairSideEntry?.(repairEntry);
    }
  }, [onRepairSideEntry, resolvedView, target, view]);

  const model = useMemo<SettingsViewModel>(() => {
    if (target.kind !== "DB") {
      return {
        closeAriaLabel: "Close database settings",
        icon: (
          <DatabaseEngineIcon className="size-4 shrink-0 object-contain text-blue-400" />
        ),
        resolvedView,
        sections: [
          {
            content: (
              <p className="text-muted-foreground text-sm">
                Database settings are unavailable.
              </p>
            ),
            id: "unsupported",
            title: "Database Settings",
          },
        ],
        subtitle: `Database · ${target.namespace}`,
        title: target.name,
      };
    }

    if (data == null) {
      const loading = dbResource.isLoading || dbResource.isValidating;
      return {
        closeAriaLabel: "Close database settings",
        icon: (
          <DatabaseEngineIcon className="size-4 shrink-0 object-contain text-blue-400" />
        ),
        resolvedView,
        sections: [
          {
            content: (
              <p className="text-muted-foreground text-sm">
                {loading
                  ? "Loading database settings…"
                  : "Database settings are unavailable."}
              </p>
            ),
            id: loading ? "loading" : "unsupported",
            title: "Database Settings",
          },
        ],
        subtitle: `Database · ${target.namespace}`,
        title: target.name,
      };
    }

    const title = displayName || data.states.name;
    return {
      closeAriaLabel: "Close database settings",
      icon: (
        <DatabaseEngineIcon
          className="size-4 shrink-0 object-contain text-blue-400"
          engine={data.states.engineKey}
          iconUrl={data.states.iconUrl}
        />
      ),
      footer: sectionsModel.footer,
      leaveGuard: sectionsModel.leaveGuard,
      resolvedView,
      sections: sectionsModel.sections,
      subtitle: `Database ${data.states.displayEngine}${
        data.states.formattedVersion ? ` ${data.states.formattedVersion}` : ""
      }`,
      title,
      titleContent: (
        <ResourceDisplayNameTitle
          displayName={title}
          onRename={canRename ? onRenameResource : undefined}
          takenNames={takenDisplayNames}
        />
      ),
    };
  }, [
    canRename,
    data,
    dbResource.isLoading,
    dbResource.isValidating,
    displayName,
    onRenameResource,
    resolvedView,
    sectionsModel,
    takenDisplayNames,
    target,
  ]);

  const {
    closeAriaLabel,
    icon,
    leaveGuard,
    subtitle,
    title,
    titleContent: modelTitleContent,
  } = model;

  useEffect(() => {
    onModelChange({
      closeAriaLabel,
      icon,
      leaveGuard,
      resolvedView,
      sections: [],
      subtitle,
      title,
      titleContent: modelTitleContent,
    });
  }, [
    closeAriaLabel,
    icon,
    leaveGuard,
    modelTitleContent,
    onModelChange,
    resolvedView,
    subtitle,
    title,
  ]);

  useEffect(() => {
    return () => onModelChange(null);
  }, [onModelChange]);

  return <SettingsSections model={model} />;
}
