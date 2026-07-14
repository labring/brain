"use client";

import { MainLayout } from "@db-browser/components/layout/MainLayout";
import { DbAccessSessionProvider } from "@db-browser/state/db-access-session";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import type { DataBrowserHostContext } from "./api/access-types";
import { DataBrowserRuntimeProvider, useDataBrowserRuntime } from "./runtime";

export interface DataBrowserPaneProps {
  kubeconfig: string;
  namespace: string;
  onDbServiceRestoreAccepted?: DataBrowserHostContext["onDbServiceRestoreAccepted"];
  projectId: string;
  refreshProjectCanvas?: () => Promise<unknown>;
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
  onDbServiceRestoreAccepted,
  refreshProjectCanvas,
  projectId,
  selectedDatabaseData,
}: DataBrowserPaneProps) {
  return (
    <DataBrowserRuntimeProvider
      kubeconfig={kubeconfig}
      namespace={namespace}
      onDbServiceRestoreAccepted={onDbServiceRestoreAccepted}
      projectId={projectId}
      refreshProjectCanvas={refreshProjectCanvas}
      selectedDatabaseData={selectedDatabaseData}
    >
      <div className="dark flex h-full min-h-0 w-full overflow-hidden text-foreground">
        <DataBrowserPaneBody />
      </div>
    </DataBrowserRuntimeProvider>
  );
}
