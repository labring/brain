"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import type { DataBrowserHostContext } from "./api/access-types";
import { normalizeDataBrowserEngine } from "./api/engine";

const DataBrowserRuntimeContext = createContext<DataBrowserHostContext | null>(
  null
);

export interface DataBrowserRuntimeProviderProps {
  children: ReactNode;
  kubeconfig: string;
  namespace: string;
  projectId: string;
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

function dbServiceUidFromNode(
  selectedDatabaseData: CanvasDatabaseNodeData
): string | undefined {
  return typeof selectedDatabaseData.uid === "string" &&
    selectedDatabaseData.uid.trim() !== ""
    ? selectedDatabaseData.uid
    : undefined;
}

export function dataBrowserRuntimeParts(
  selectedDatabaseData: CanvasDatabaseNodeData
) {
  const { states, workload } = selectedDatabaseData;

  return {
    backups: dbServiceBackupsFromNode(selectedDatabaseData),
    databaseDisplayEngine: states.displayEngine,
    databaseEngineKey: states.engineKey,
    databaseFormattedVersion: states.formattedVersion,
    databaseName: states.name,
    databaseWorkloadName: workload.name,
    databaseWorkloadNamespace: workload.namespace,
    dbServiceUid: dbServiceUidFromNode(selectedDatabaseData),
    engine: normalizeDataBrowserEngine(states.engineKey),
  };
}

type DataBrowserRuntimeParts = ReturnType<typeof dataBrowserRuntimeParts>;

function dataBrowserHostContextFromParts({
  backups,
  databaseDisplayEngine,
  databaseEngineKey,
  databaseFormattedVersion,
  databaseName,
  databaseWorkloadName,
  databaseWorkloadNamespace,
  dbServiceUid,
  engine,
  kubeconfig,
  namespace,
  projectId,
}: DataBrowserRuntimeParts &
  Pick<
    DataBrowserRuntimeProviderProps,
    "kubeconfig" | "namespace" | "projectId"
  >): DataBrowserHostContext {
  return {
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
    engine,
    kubeconfig,
    namespace,
    projectId,
  };
}

export function createDataBrowserHostContext({
  kubeconfig,
  namespace,
  projectId,
  selectedDatabaseData,
}: Omit<DataBrowserRuntimeProviderProps, "children">): DataBrowserHostContext {
  return dataBrowserHostContextFromParts({
    kubeconfig,
    namespace,
    projectId,
    ...dataBrowserRuntimeParts(selectedDatabaseData),
  });
}

export function DataBrowserRuntimeProvider({
  children,
  kubeconfig,
  namespace,
  projectId,
  selectedDatabaseData,
}: DataBrowserRuntimeProviderProps) {
  const {
    databaseDisplayEngine,
    databaseEngineKey,
    databaseFormattedVersion,
    databaseName,
    databaseWorkloadName,
    databaseWorkloadNamespace,
    dbServiceUid,
    engine,
  } = dataBrowserRuntimeParts(selectedDatabaseData);
  const rawBackups = selectedDatabaseData.backups;
  const value = useMemo<DataBrowserHostContext>(
    () =>
      dataBrowserHostContextFromParts({
        backups: dbServiceBackupsFromValue(rawBackups),
        databaseDisplayEngine,
        databaseEngineKey,
        databaseFormattedVersion,
        databaseName,
        databaseWorkloadName,
        databaseWorkloadNamespace,
        dbServiceUid,
        engine,
        kubeconfig,
        namespace,
        projectId,
      }),
    [
      databaseDisplayEngine,
      databaseEngineKey,
      databaseFormattedVersion,
      databaseName,
      databaseWorkloadName,
      databaseWorkloadNamespace,
      dbServiceUid,
      engine,
      kubeconfig,
      namespace,
      projectId,
      rawBackups,
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
