"use client";

import {
  useApsK8sList,
  useDbsK8sList,
  useEntryPointList,
} from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { CanvasState } from "@workspace/ui/components/canvas/canvas.types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  apsToCanvasState,
  dbsToCanvasState,
  entryPointsToCanvasState,
} from "@/features/project-canvas/flow/ap-list-to-canvas-state";
import { detectedCanvasConnectionEdges } from "@/features/project-canvas/flow/detected-connections";
import { mergeCanvasLayoutWithDetectedNodes } from "@/features/project-canvas/layout/merge";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
} from "@/features/project-canvas/layout/types";
import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import {
  entryPointRefreshIntervalForLifecycle,
  workloadListRefreshIntervalForCanvas,
} from "./project-services-refresh";

const WORKLOAD_DISCOVERY_POLL_WINDOW_MS = 8000;
const WORKLOAD_RECONCILE_POLL_WINDOW_MS = 30_000;

export function useProjectServices(options: {
  canvasLayout?: CanvasLayoutDocument;
  canvasLayoutReady?: boolean;
  /** URL-encoded kubeconfig (Authorization bearer body). */
  kubeconfig: string;
  /** K8s namespace for AP, DB, and entrypoint discovery. */
  namespace: string;
  onCanvasLayoutMerge?: (nodes: CanvasLayoutNode[]) => void;
  /** Project UID from the route (decoded). */
  uid: string;
}): {
  /** Raw list payloads for canvas-adjacent tooling. */
  data: {
    aps: K8sGetResponse | undefined;
    dbs: K8sGetResponse | undefined;
    entryPoints: K8sGetResponse | undefined;
  };
  canvasState: CanvasState;
  error: Error | undefined;
  /** True only during the initial AP/DB fetch while the graph is still empty — clears when lists settle even if there are zero workloads. */
  isEmptyGraphLoading: boolean;
  isLoading: boolean;
  /** Refetch AP + DB list SWR caches (e.g. after lifecycle mutations). */
  refreshWorkloadLists: () => Promise<unknown>;
} {
  const {
    canvasLayout,
    canvasLayoutReady = true,
    kubeconfig,
    namespace,
    onCanvasLayoutMerge,
    uid,
  } = options;

  const labelSelector = useMemo(
    () => `${BRAIN_PROJECT_ID_LABEL}=${uid}`,
    [uid]
  );

  const apsListRef = useRef<K8sGetResponse | undefined>(undefined);
  const dbsListRef = useRef<K8sGetResponse | undefined>(undefined);
  const [workloadDiscoveryPollUntil, setWorkloadDiscoveryPollUntil] =
    useState(0);
  const [workloadReconcilePollUntil, setWorkloadReconcilePollUntil] =
    useState(0);
  const peerDbsEmpty = useCallback(
    () => apItemsFromList(dbsListRef.current).length === 0,
    []
  );
  const peerApsEmpty = useCallback(
    () => apItemsFromList(apsListRef.current).length === 0,
    []
  );
  const resetWorkloadDiscoveryPollWindow = useCallback(() => {
    setWorkloadDiscoveryPollUntil(
      Date.now() + WORKLOAD_DISCOVERY_POLL_WINDOW_MS
    );
  }, []);
  const workloadListRefreshInterval = useCallback(
    (latestData: K8sGetResponse | undefined, peerEmpty: () => boolean) =>
      workloadListRefreshIntervalForCanvas({
        discoveryPollUntil: workloadDiscoveryPollUntil,
        latestData,
        peerEmpty: peerEmpty(),
        workloadReconcilePollUntil,
      }),
    [workloadDiscoveryPollUntil, workloadReconcilePollUntil]
  );
  const apListRefreshInterval = useCallback(
    (latestData: K8sGetResponse | undefined) =>
      workloadListRefreshInterval(latestData, peerDbsEmpty),
    [peerDbsEmpty, workloadListRefreshInterval]
  );
  const dbListRefreshInterval = useCallback(
    (latestData: K8sGetResponse | undefined) =>
      workloadListRefreshInterval(latestData, peerApsEmpty),
    [peerApsEmpty, workloadListRefreshInterval]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset discovery polling when project changes
  useEffect(() => {
    resetWorkloadDiscoveryPollWindow();
    setWorkloadReconcilePollUntil(0);
  }, [labelSelector]);

  const {
    data: apsData,
    error: apsError,
    isLoading: apsLoading,
    mutate: mutateAps,
  } = useApsK8sList({
    kubeconfig,
    labelSelector,
    namespace,
    pollWhileEmpty: false,
    refreshInterval: apListRefreshInterval,
  });

  const {
    data: dbsData,
    error: dbsError,
    isLoading: dbsLoading,
    mutate: mutateDbs,
  } = useDbsK8sList({
    kubeconfig,
    labelSelector,
    namespace,
    pollWhileEmpty: false,
    refreshInterval: dbListRefreshInterval,
  });
  const entryPointRefreshInterval = useCallback(
    (latestData: K8sGetResponse | undefined) =>
      entryPointRefreshIntervalForLifecycle({
        apsData,
        entryPointsData: latestData,
        workloadReconcilePollUntil,
      }),
    [apsData, workloadReconcilePollUntil]
  );
  const {
    data: entryPointsData,
    error: entryPointsError,
    isLoading: entryPointsLoading,
    mutate: mutateEntryPoints,
  } = useEntryPointList({
    kubeconfig,
    labelSelector,
    namespace,
    refreshInterval: entryPointRefreshInterval,
  });
  apsListRef.current = apsData;
  dbsListRef.current = dbsData;

  const refreshWorkloadLists = useCallback(() => {
    setWorkloadReconcilePollUntil(
      Date.now() + WORKLOAD_RECONCILE_POLL_WINDOW_MS
    );
    resetWorkloadDiscoveryPollWindow();
    return Promise.all([mutateAps(), mutateDbs(), mutateEntryPoints()]);
  }, [
    mutateAps,
    mutateDbs,
    mutateEntryPoints,
    resetWorkloadDiscoveryPollWindow,
  ]);

  const data = useMemo(
    () => ({ aps: apsData, dbs: dbsData, entryPoints: entryPointsData }),
    [apsData, dbsData, entryPointsData]
  );

  const layoutMerge = useMemo(() => {
    const apBlock = apsToCanvasState(apsData, {
      gridIndexOffset: 0,
      namespaceFallback: namespace,
    });
    const dbBlock = dbsToCanvasState(dbsData, {
      gridIndexOffset: apBlock.nodes.length,
      namespaceFallback: namespace,
    });
    const entryPointBlock = entryPointsToCanvasState(entryPointsData, {
      apsData,
      gridIndexOffset: apBlock.nodes.length + dbBlock.nodes.length,
      namespaceFallback: namespace,
    });
    const detectedNodes = [
      ...apBlock.nodes,
      ...dbBlock.nodes,
      ...entryPointBlock.nodes,
    ];
    const merge = canvasLayoutReady
      ? mergeCanvasLayoutWithDetectedNodes({
          layout: canvasLayout,
          nodes: detectedNodes,
        })
      : { changed: false, layout: canvasLayout, nodes: [] };
    const edges = canvasLayoutReady
      ? detectedCanvasConnectionEdges({
          apsData,
          dbsData,
          entryPointsData,
          namespaceFallback: namespace,
          nodes: merge.nodes,
        })
      : [];
    return {
      changed: merge.changed,
      edges,
      layout: merge.layout,
      nodes: merge.nodes,
    };
  }, [
    apsData,
    canvasLayout,
    canvasLayoutReady,
    dbsData,
    entryPointsData,
    namespace,
  ]);

  useEffect(() => {
    if (!layoutMerge.changed || layoutMerge.layout === undefined) {
      return;
    }
    onCanvasLayoutMerge?.(layoutMerge.layout.nodes);
  }, [layoutMerge.changed, layoutMerge.layout, onCanvasLayoutMerge]);

  const canvasState = useMemo((): CanvasState => {
    return {
      edges: layoutMerge.edges,
      nodes: layoutMerge.nodes,
      selectedEdge: null,
      selectedNode: null,
    };
  }, [layoutMerge.edges, layoutMerge.nodes]);

  const error = apsError ?? dbsError ?? entryPointsError;
  const isLoading = apsLoading || dbsLoading || entryPointsLoading;
  const graphEmpty =
    canvasState.nodes.length === 0 && canvasState.edges.length === 0;

  // Sticky: once nodes have appeared, never show the bootstrap spinner again.
  // This avoids flicker from `isValidating` oscillating between poll cycles.
  const hasEverHadNodes = useRef(false);
  const projectIdRef = useRef(uid);
  if (projectIdRef.current !== uid) {
    projectIdRef.current = uid;
    hasEverHadNodes.current = false;
  }
  if (!graphEmpty) {
    hasEverHadNodes.current = true;
  }

  // Grace period: `isLoading` clears after the first SWR response, but
  // `pollWhileEmpty` may need several more 1 s cycles for K8s to reconcile.
  // A timeout lets the toast cover that gap without using `isValidating`
  // (which flickers). If nodes appear before the timeout, `hasEverHadNodes`
  // hides the toast immediately.
  const [discoveryTimedOut, setDiscoveryTimedOut] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset timer when project changes
  useEffect(() => {
    setDiscoveryTimedOut(false);
    const t = setTimeout(() => setDiscoveryTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [labelSelector]);

  const isEmptyGraphLoading =
    graphEmpty && !hasEverHadNodes.current && !discoveryTimedOut;

  return {
    data,
    canvasState,
    error,
    isEmptyGraphLoading,
    isLoading,
    refreshWorkloadLists,
  };
}
