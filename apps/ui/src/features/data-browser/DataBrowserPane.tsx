"use client";

import { MainLayout } from "@data-browser/components/layout/MainLayout";
import { DbAccessSessionProvider } from "@data-browser/state/db-access-session";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import { DataBrowserRuntimeProvider, useDataBrowserRuntime } from "./runtime";

export interface DataBrowserPaneProps {
  kubeconfig: string;
  namespace: string;
  projectId: string;
  selectedDatabaseData: CanvasDatabaseNodeData;
}

function DataBrowserPaneBody() {
  const runtime = useDataBrowserRuntime();

  return (
    <DbAccessSessionProvider runtime={runtime}>
      <MainLayout />
    </DbAccessSessionProvider>
  );
}

export function DataBrowserPane({
  kubeconfig,
  namespace,
  projectId,
  selectedDatabaseData,
}: DataBrowserPaneProps) {
  return (
    <DataBrowserRuntimeProvider
      kubeconfig={kubeconfig}
      namespace={namespace}
      projectId={projectId}
      selectedDatabaseData={selectedDatabaseData}
    >
      <div className="dark flex h-full min-h-0 w-full overflow-hidden text-foreground">
        <DataBrowserPaneBody />
      </div>
    </DataBrowserRuntimeProvider>
  );
}
