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

export function dataBrowserRuntimeParts(
  selectedDatabaseData: CanvasDatabaseNodeData
) {
  const { states, workload } = selectedDatabaseData;

  return {
    databaseDisplayEngine: states.displayEngine,
    databaseEngineKey: states.engineKey,
    databaseFormattedVersion: states.formattedVersion,
    databaseName: states.name,
    databaseWorkloadName: workload.name,
    databaseWorkloadNamespace: workload.namespace,
    engine: normalizeDataBrowserEngine(states.engineKey),
  };
}

export function createDataBrowserHostContext({
  kubeconfig,
  namespace,
  projectId,
  selectedDatabaseData,
}: Omit<DataBrowserRuntimeProviderProps, "children">): DataBrowserHostContext {
  const parts = dataBrowserRuntimeParts(selectedDatabaseData);

  return {
    database: {
      displayEngine: parts.databaseDisplayEngine,
      ...(parts.databaseEngineKey === undefined
        ? {}
        : { engineKey: parts.databaseEngineKey }),
      ...(parts.databaseFormattedVersion === undefined
        ? {}
        : { formattedVersion: parts.databaseFormattedVersion }),
      name: parts.databaseName,
    },
    databaseWorkloadName: parts.databaseWorkloadName,
    databaseWorkloadNamespace: parts.databaseWorkloadNamespace,
    engine: parts.engine,
    kubeconfig,
    namespace,
    projectId,
  };
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
    engine,
  } = dataBrowserRuntimeParts(selectedDatabaseData);
  const value = useMemo<DataBrowserHostContext>(
    () => ({
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
      databaseWorkloadName,
      databaseWorkloadNamespace,
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
      engine,
      kubeconfig,
      namespace,
      projectId,
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
