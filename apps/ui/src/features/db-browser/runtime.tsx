"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import type {
  DataBrowserDBServiceBackupPolicy,
  DataBrowserHostContext,
} from "./api/access-types";
import { normalizeDataBrowserEngine } from "./api/engine";

const DataBrowserRuntimeContext = createContext<DataBrowserHostContext | null>(
  null
);

export interface DataBrowserRuntimeProviderProps {
  children: ReactNode;
  kubeconfig: string;
  namespace: string;
  onDbServiceRestoreAccepted?: DataBrowserHostContext["onDbServiceRestoreAccepted"];
  projectId: string;
  refreshProjectCanvas?: () => Promise<unknown>;
  selectedDatabaseData: CanvasDatabaseNodeData;
}

function dbServiceBackupsFromValue(backups: unknown): unknown[] {
  return Array.isArray(backups) ? backups : [];
}

function dbServiceBackupsFromNode(
  selectedDatabaseData: CanvasDatabaseNodeData
): unknown[] {
  return dbServiceBackupsFromValue(selectedDatabaseData.backups);
}

function dbServiceBackupPolicyFromValue(
  backupPolicy: unknown
): DataBrowserDBServiceBackupPolicy | undefined {
  return backupPolicy != null && typeof backupPolicy === "object"
    ? (backupPolicy as DataBrowserDBServiceBackupPolicy)
    : undefined;
}

function dbServiceUidFromNode(
  selectedDatabaseData: CanvasDatabaseNodeData
): string | undefined {
  return typeof selectedDatabaseData.uid === "string" &&
    selectedDatabaseData.uid.trim() !== ""
    ? selectedDatabaseData.uid
    : undefined;
}

function dbServicePhaseFromNode(
  selectedDatabaseData: CanvasDatabaseNodeData
): string | undefined {
  const phase = selectedDatabaseData.states.status?.label;
  return typeof phase === "string" && phase.trim() !== ""
    ? phase.trim()
    : undefined;
}

export function dataBrowserRuntimeParts(
  selectedDatabaseData: CanvasDatabaseNodeData
) {
  const { states, workload } = selectedDatabaseData;

  return {
    backupPolicy: dbServiceBackupPolicyFromValue(
      selectedDatabaseData.backupPolicy
    ),
    backups: dbServiceBackupsFromNode(selectedDatabaseData),
    databaseDisplayEngine: states.displayEngine,
    databaseEngineKey: states.engineKey,
    databaseFormattedVersion: states.formattedVersion,
    databaseName: states.name,
    databaseWorkloadName: workload.name,
    databaseWorkloadNamespace: workload.namespace,
    dbServicePhase: dbServicePhaseFromNode(selectedDatabaseData),
    dbServiceUid: dbServiceUidFromNode(selectedDatabaseData),
    engine: normalizeDataBrowserEngine(states.engineKey),
  };
}

type DataBrowserRuntimeParts = ReturnType<typeof dataBrowserRuntimeParts>;

function dataBrowserHostContextFromParts({
  backupPolicy,
  backups,
  databaseDisplayEngine,
  databaseEngineKey,
  databaseFormattedVersion,
  databaseName,
  databaseWorkloadName,
  databaseWorkloadNamespace,
  dbServicePhase,
  dbServiceUid,
  engine,
  kubeconfig,
  namespace,
  onDbServiceRestoreAccepted,
  projectId,
  refreshProjectCanvas,
}: DataBrowserRuntimeParts &
  Pick<
    DataBrowserRuntimeProviderProps,
    | "kubeconfig"
    | "namespace"
    | "onDbServiceRestoreAccepted"
    | "projectId"
    | "refreshProjectCanvas"
  >): DataBrowserHostContext {
  return {
    ...(backupPolicy === undefined ? {} : { backupPolicy }),
    backups,
    database: {
      displayEngine: databaseDisplayEngine,
      ...(databaseEngineKey === undefined
        ? {}
        : { engineKey: databaseEngineKey }),
      ...(databaseFormattedVersion === undefined
        ? {}
        : { formattedVersion: databaseFormattedVersion }),
      name: databaseName,
    },
    dbService: {
      name: databaseWorkloadName,
      namespace: databaseWorkloadNamespace,
      ...(dbServiceUid === undefined ? {} : { uid: dbServiceUid }),
    },
    databaseWorkloadName,
    databaseWorkloadNamespace,
    ...(dbServicePhase === undefined ? {} : { dbServicePhase }),
    engine,
    kubeconfig,
    namespace,
    ...(onDbServiceRestoreAccepted === undefined
      ? {}
      : { onDbServiceRestoreAccepted }),
    projectId,
    ...(refreshProjectCanvas === undefined ? {} : { refreshProjectCanvas }),
  };
}

export function createDataBrowserHostContext({
  kubeconfig,
  namespace,
  onDbServiceRestoreAccepted,
  projectId,
  refreshProjectCanvas,
  selectedDatabaseData,
}: Omit<DataBrowserRuntimeProviderProps, "children">): DataBrowserHostContext {
  return dataBrowserHostContextFromParts({
    kubeconfig,
    namespace,
    onDbServiceRestoreAccepted,
    projectId,
    refreshProjectCanvas,
    ...dataBrowserRuntimeParts(selectedDatabaseData),
  });
}

export function DataBrowserRuntimeProvider({
  children,
  kubeconfig,
  namespace,
  onDbServiceRestoreAccepted,
  projectId,
  refreshProjectCanvas,
  selectedDatabaseData,
}: DataBrowserRuntimeProviderProps) {
  const {
    backupPolicy,
    databaseDisplayEngine,
    databaseEngineKey,
    databaseFormattedVersion,
    databaseName,
    databaseWorkloadName,
    databaseWorkloadNamespace,
    dbServicePhase,
    dbServiceUid,
    engine,
  } = dataBrowserRuntimeParts(selectedDatabaseData);
  const rawBackups = selectedDatabaseData.backups;
  const value = useMemo<DataBrowserHostContext>(
    () =>
      dataBrowserHostContextFromParts({
        backups: dbServiceBackupsFromValue(rawBackups),
        backupPolicy,
        databaseDisplayEngine,
        databaseEngineKey,
        databaseFormattedVersion,
        databaseName,
        databaseWorkloadName,
        databaseWorkloadNamespace,
        dbServicePhase,
        dbServiceUid,
        engine,
        kubeconfig,
        namespace,
        onDbServiceRestoreAccepted,
        projectId,
        refreshProjectCanvas,
      }),
    [
      databaseDisplayEngine,
      databaseEngineKey,
      databaseFormattedVersion,
      databaseName,
      databaseWorkloadName,
      databaseWorkloadNamespace,
      dbServicePhase,
      dbServiceUid,
      engine,
      kubeconfig,
      namespace,
      onDbServiceRestoreAccepted,
      projectId,
      refreshProjectCanvas,
      rawBackups,
      backupPolicy,
    ]
  );

  return (
    <DataBrowserRuntimeContext.Provider value={value}>
      {children}
    </DataBrowserRuntimeContext.Provider>
  );
}

export function useDataBrowserRuntime(): DataBrowserHostContext {
  const value = useContext(DataBrowserRuntimeContext);

  if (value === null) {
    throw new Error(
      "useDataBrowserRuntime must be used within DataBrowserRuntimeProvider"
    );
  }

  return value;
}
