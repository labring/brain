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
import { apMetricsLookupFromSnapshot } from "@/features/project-canvas/flow/ap-list-to-canvas-state";
import { useProjectCanvasLayout } from "@/features/project-canvas/layout/use-project-canvas-layout";
import { buildPreviewProjectCanvasState } from "@/features/project-canvas/preview/state";
import { PreviewProjectCanvasWorkbenchSurfaces } from "@/features/project-canvas/workbench/project-canvas-workbench-surfaces";
import { useProjectCanvas } from "@/features/project-canvas/workbench/use-project-canvas";

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

  const workbench = useProjectCanvas(canvasState.nodes, {
    edges: canvasState.edges,
    readOnly: true,
    refreshWorkloadLists,
    selectionReady: !isLoading,
    shareToken,
  });

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
          meta={workbench.meta}
          state={{
            ...canvasState,
            connectionOrigin: workbench.connectionOrigin,
            nodes: workbench.nodes,
            selectedEdge: workbench.selectedEdge,
            selectedNode: workbench.selectedNode,
          }}
        >
          <Canvas.Flow>
            <PreviewProjectCanvasWorkbenchSurfaces
              namespace={ns}
              projectUid={uid}
              refreshWorkloadLists={refreshWorkloadLists}
              shareToken={shareToken}
              workbench={workbench}
            />
          </Canvas.Flow>
        </Canvas.Root>
      </div>
    );
  }

  return null;
}
