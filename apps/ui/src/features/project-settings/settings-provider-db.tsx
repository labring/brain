"use client";

import { useDbSettingsOperations, useDbsK8sList } from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import { Database } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { dbToDatabaseNodeData } from "@/features/project-canvas/flow/ap-list-to-canvas-state";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import { useDatabaseSettingsSections } from "@/features/project-canvas/panels/database-settings-pane";
import type { ProjectSideSurfaceEntry } from "@/features/project-surfaces/surface-state";
import type { ProjectDbTarget } from "@/features/project-surfaces/target-identity";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import { SettingsSections } from "./settings-sections";
import type {
  SettingsProviderProps,
  SettingsViewModel,
} from "./settings-types";

const DB_SETTINGS_FULL_VIEW = "full";

function DatabaseSettingsIcon({ iconUrl }: { iconUrl?: string }) {
  const resolvedIconUrl = iconUrl?.trim();
  if (resolvedIconUrl) {
    return (
      // biome-ignore lint/performance/noImgElement: DB icons are arbitrary remote URLs that are not covered by Next image domain config.
      <img
        alt=""
        className="size-4 object-contain"
        decoding="async"
        height={16}
        loading="lazy"
        src={resolvedIconUrl}
        width={16}
      />
    );
  }
  return <Database aria-hidden className="size-4 shrink-0 text-blue-400" />;
}

function metadataRecord(resource: unknown): Record<string, unknown> {
  if (resource == null || typeof resource !== "object") {
    return {};
  }
  const metadata = (resource as Record<string, unknown>).metadata;
  return metadata != null && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};
}

function resourceMatchesDbTarget(resource: unknown, target: ProjectDbTarget) {
  const metadata = metadataRecord(resource);
  const name = typeof metadata.name === "string" ? metadata.name : "";
  const namespace =
    typeof metadata.namespace === "string" ? metadata.namespace : "";
  const uid = typeof metadata.uid === "string" ? metadata.uid : undefined;
  return (
    name === target.name &&
    (namespace === "" || namespace === target.namespace) &&
    (target.observedUid == null || uid == null || target.observedUid === uid)
  );
}

export function dbDataFromList(
  data: ReturnType<typeof useDbsK8sList>["data"],
  target: ProjectDbTarget | null
): CanvasDatabaseNodeData | null {
  if (target == null) {
    return null;
  }
  const resource = apItemsFromList(data).find((item) =>
    resourceMatchesDbTarget(item, target)
  );
  return resource == null
    ? null
    : dbToDatabaseNodeData(resource, { namespaceFallback: target.namespace });
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
  sourceContext,
  target,
  view,
}: SettingsProviderProps) {
  const resolvedView = resolvedDbSettingsView(view);
  const dbTarget = target.kind === "DB" ? target : null;
  const dbsList = useDbsK8sList({
    kubeconfig: dbTarget == null ? "" : (kubeconfig ?? ""),
    namespace: dbTarget?.namespace,
  });
  const listData = useMemo(
    () => dbDataFromList(dbsList.data, dbTarget),
    [dbTarget, dbsList.data]
  );
  const data = sourceContext?.databaseData ?? listData ?? undefined;
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
      } satisfies CanvasDatabaseNodeData),
    editable: data != null && !effectiveReadOnly && authReady,
    onSubmitPatch:
      data != null && !effectiveReadOnly && authReady
        ? handleSubmitPatch
        : undefined,
    onUpdated,
    routingDomain,
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
        icon: <DatabaseSettingsIcon />,
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
      const loading = dbsList.isLoading || dbsList.isValidating;
      return {
        closeAriaLabel: "Close database settings",
        icon: <DatabaseSettingsIcon />,
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
      icon: <DatabaseSettingsIcon iconUrl={data.states.iconUrl} />,
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
    dbsList.isLoading,
    dbsList.isValidating,
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
