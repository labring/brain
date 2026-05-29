"use client";

import {
  useApsK8sList,
  useDbsK8sList,
  useEntryPointList,
  useWorkloadTelemetrySnapshotBatch,
} from "@workspace/api/hooks";
import { apNamespaceNameTargetsFromList } from "@workspace/api/lib/ap-list";
import { PROJECT_UID_LABEL } from "@workspace/crossplane/constants";
import { Canvas } from "@workspace/ui/components/canvas/canvas";
import type { CanvasState } from "@workspace/ui/components/canvas/canvas.types";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { useProjectCanvas } from "@/hooks/use-project-canvas";
import { useProjectCanvasLayout } from "@/hooks/use-project-canvas-layout";
import { CanvasActionSurface } from "@/lib/project-canvas/actions/canvas-action-surface";
import { apMetricsLookupFromSnapshot } from "@/lib/project-canvas/flow/ap-list-to-canvas-state";
import { databaseNodeDataFromNode } from "@/lib/project-canvas/nodes/database-node-data";
import { DatabaseLogsPane } from "@/lib/project-canvas/panels/database-logs-pane";
import { ProjectCanvasResourcePane } from "@/lib/project-canvas/panels/project-canvas-resource-pane";
import { WorkloadLogsPane } from "@/lib/project-canvas/panels/workload-logs-panel";
import { buildPreviewProjectCanvasState } from "@/lib/project-canvas/preview/state";
import { DATABASE_PANE, WORKLOAD_PANE } from "@/store/canvas-store";

const METRICS_REFRESH_MS = 5000;

/** Share-token preview only (kubeconfig path uses `useProjectServices` on `/project/[uid]`). */
function usePreviewProjectCanvas(options: {
  namespace: string;
  shareToken: string;
  uid: string;
}): {
  canvasState: CanvasState;
  error: Error | undefined;
  isLoading: boolean;
  refreshWorkloadLists: () => Promise<unknown>;
} {
  const { namespace, shareToken, uid } = options;

  const labelSelector = useMemo(() => `${PROJECT_UID_LABEL}=${uid}`, [uid]);

  const { data, error, isLoading, mutate } = useApsK8sList({
    labelSelector,
    namespace,
    shareToken: shareToken.trim() === "" ? undefined : shareToken.trim(),
  });
  const {
    data: dbsData,
    error: dbsError,
    isLoading: dbsLoading,
    mutate: mutateDbs,
  } = useDbsK8sList({
    labelSelector,
    namespace,
    shareToken: shareToken.trim() === "" ? undefined : shareToken.trim(),
  });
  const {
    data: entryPointsData,
    error: entryPointsError,
    isLoading: entryPointsLoading,
    mutate: mutateEntryPoints,
  } = useEntryPointList({
    labelSelector,
    namespace,
    shareToken: shareToken.trim() === "" ? undefined : shareToken.trim(),
  });
  const projectCanvasLayout = useProjectCanvasLayout({
    enabled: namespace !== "" && shareToken.trim() !== "" && uid !== "",
    namespace,
    projectUid: uid,
    shareToken,
  });

  const refreshWorkloadLists = useCallback(
    () => Promise.all([mutate(), mutateDbs(), mutateEntryPoints()]),
    [mutate, mutateDbs, mutateEntryPoints]
  );

  const apMetricsTargets = useMemo(
    () =>
      apNamespaceNameTargetsFromList(data, namespace).map((t) => ({
        ...t,
        kind: "ap" as const,
      })),
    [data, namespace]
  );

  const st = shareToken.trim();
  const { data: apMetrics } = useWorkloadTelemetrySnapshotBatch({
    refreshInterval: METRICS_REFRESH_MS,
    shareToken: st === "" ? undefined : st,
    targets: apMetricsTargets,
  });

  const metricsLookup = useMemo(
    () => apMetricsLookupFromSnapshot(apMetrics),
    [apMetrics]
  );

  const canvasState = useMemo(
    (): CanvasState =>
      buildPreviewProjectCanvasState({
        apMetricsLookup: metricsLookup,
        apsData: data,
        canvasLayout: projectCanvasLayout.layout,
        canvasLayoutReady: projectCanvasLayout.layoutReady,
        dbsData,
        entryPointsData,
        namespace,
      }),
    [
      data,
      dbsData,
      entryPointsData,
      metricsLookup,
      namespace,
      projectCanvasLayout.layout,
      projectCanvasLayout.layoutReady,
    ]
  );

  return {
    canvasState,
    error: error ?? dbsError ?? entryPointsError,
    isLoading:
      isLoading ||
      dbsLoading ||
      entryPointsLoading ||
      !projectCanvasLayout.layoutReady,
    refreshWorkloadLists,
  };
}

/**
 * Client-only: fetches AP list + snapshot telemetry via share token. Share access is checked in `layout.tsx`.
 */
export default function PreviewProjectPage() {
  const params = useParams<{ uid: string }>();
  const searchParams = useSearchParams();
  const uid = decodeURIComponent(params.uid ?? "");
  const ns = (searchParams.get("ns") ?? "").trim();
  const shareToken = (searchParams.get("shareToken") ?? "").trim();

  const { canvasState, error, isLoading, refreshWorkloadLists } =
    usePreviewProjectCanvas({
      namespace: ns,
      shareToken,
      uid,
    });

  const {
    canvasAction,
    closeCanvasActionSurface,
    closeResourceLogsSurface,
    closeResourcePane,
    connectionOrigin,
    databasePane,
    entryPane,
    meta,
    nodes,
    registerSettingsLeaveGuard,
    selectedEntryRef,
    selectedEdge,
    selectedNode,
    settingsLeaveGuardDialog,
    workloadPane,
  } = useProjectCanvas(canvasState.nodes, {
    readOnly: true,
    refreshWorkloadLists,
    selectionReady: !isLoading,
    shareToken,
  });
  const selectedDatabaseData = databaseNodeDataFromNode(selectedNode);
  const workloadLogsSurfaceOpen =
    workloadPane === WORKLOAD_PANE.logs && selectedNode != null;
  const databaseLogsSurfaceOpen =
    databasePane === DATABASE_PANE.logs && selectedNode != null;

  const missingParams = shareToken === "" || ns === "" || uid === "";
  const blocked = missingParams || isLoading || error != null;
  const hasNodes = canvasState.nodes.length > 0;
  const showCanvas = !blocked && hasNodes;

  if (missingParams) {
    return (
      <p className="text-muted-foreground text-sm">
        Missing preview link parameters. Use{" "}
        <code className="rounded bg-muted px-1">shareToken</code> and{" "}
        <code className="rounded bg-muted px-1">ns</code> query params.
      </p>
    );
  }

  if (showCanvas) {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col">
        <Canvas.Root
          key={`${ns}:${uid}:${shareToken}`}
          meta={meta}
          state={{
            ...canvasState,
            connectionOrigin,
            nodes,
            selectedEdge,
            selectedNode,
          }}
        >
          <Canvas.Flow>
            <ProjectCanvasResourcePane
              databasePane={databaseLogsSurfaceOpen ? null : databasePane}
              entryPane={entryPane}
              onClose={closeResourcePane}
              onSettingsLeaveGuardChange={registerSettingsLeaveGuard}
              onUpdated={refreshWorkloadLists}
              readOnly
              selectedDatabaseData={selectedDatabaseData}
              selectedEntryRef={selectedEntryRef}
              selectedNode={selectedNode}
              shareToken={shareToken}
              workloadPane={workloadLogsSurfaceOpen ? null : workloadPane}
            />
            <CanvasActionSurface
              action={canvasAction}
              dbAccessEnabled={false}
              kubeconfig=""
              namespace={ns}
              onClose={closeCanvasActionSurface}
              projectUid={uid}
              selectedDatabaseData={selectedDatabaseData}
            />
            {workloadLogsSurfaceOpen ? (
              <WorkloadLogsPane
                node={selectedNode}
                onClose={closeResourceLogsSurface}
              />
            ) : null}
            {databaseLogsSurfaceOpen ? (
              <DatabaseLogsPane
                kubeconfig=""
                node={selectedNode}
                onClose={closeResourceLogsSurface}
                open
              />
            ) : null}
            {settingsLeaveGuardDialog}
          </Canvas.Flow>
        </Canvas.Root>
      </div>
    );
  }

  return null;
}
