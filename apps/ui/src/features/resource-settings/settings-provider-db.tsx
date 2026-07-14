"use client";

import {
  useBrainProductResource,
  useDbSettingsOperations,
} from "@workspace/api/hooks";
import { DatabaseEngineIcon } from "@workspace/ui/components/database-engine-icon";
import { useCallback, useEffect, useMemo } from "react";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { ProjectDbTarget } from "@/features/project-surfaces/target-identity";
import { k8sGetClaimBody } from "@/features/resource-settings/ap/k8s/claim-mapper";
import { dbResourceToSettingsData } from "@/features/resource-settings/db/db-settings-resource";
import { useDatabaseSettingsSections } from "@/features/resource-settings/db/db-settings-sections";
import type { DbSettingsData } from "@/features/resource-settings/db/db-settings-types";
import { settingsOwnerIdentity } from "@/features/resource-settings/settings-owner-identity";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { SettingsSections } from "./settings-sections";
import type {
  SettingsProviderProps,
  SettingsViewModel,
} from "./settings-types";

const DB_SETTINGS_FULL_VIEW = "full";

export function dbSettingsDataFromExactResource(
  data: ReturnType<typeof useBrainProductResource>["data"],
  target: ProjectDbTarget | null
): DbSettingsData | null {
  if (target == null) {
    return null;
  }
  const resource = k8sGetClaimBody(data);
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
  readOnly,
  target,
  view,
}: SettingsProviderProps) {
  const resolvedView = resolvedDbSettingsView(view);
  const dbTarget = target.kind === "DB" ? target : null;
  const dbResource = useBrainProductResource({
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
      title: data.states.name,
    };
  }, [
    data,
    dbResource.isLoading,
    dbResource.isValidating,
    resolvedView,
    sectionsModel,
    target,
  ]);

  const { closeAriaLabel, icon, leaveGuard, subtitle, title } = model;

  useEffect(() => {
    onModelChange({
      closeAriaLabel,
      icon,
      leaveGuard,
      resolvedView,
      sections: [],
      subtitle,
      title,
    });
  }, [
    closeAriaLabel,
    icon,
    leaveGuard,
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
