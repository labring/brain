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
  apLikeWorkloadKeysFromList,
  apsToCanvasState,
  dbsToCanvasState,
  entryPointsToCanvasState,
  templateNativeWorkloadsToCanvasState,
} from "@/features/project-canvas/flow/ap-list-to-canvas-state";
import {
  canvasConnectionEdgesFromDetectedConnections,
  detectCanvasConnections,
} from "@/features/project-canvas/flow/detected-connections";
import { mergeCanvasLayoutWithDetectedNodes } from "@/features/project-canvas/layout/merge";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
} from "@/features/project-canvas/layout/types";
import {
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_RESOURCE_KIND_LABEL,
} from "@/lib/brain-labels";
import {
  entryPointRefreshIntervalForLifecycle,
  workloadListRefreshIntervalForCanvas,
} from "./project-services-refresh";
import { useTemplateNativeWorkloads } from "./use-template-native-workloads";

const WORKLOAD_DISCOVERY_POLL_WINDOW_MS = 8000;
const WORKLOAD_RECONCILE_POLL_WINDOW_MS = 30_000;

export function useProjectServices(options: {
  canvasLayout?: CanvasLayoutDocument;
  canvasLayoutReady?: boolean;
  /** URL-encoded kubeconfig (Authorization bearer body). */
  kubeconfig: string;
  /** K8s namespace for AP, DB, and entrypoint discovery. */
  namespace: string;
  onCanvasFirstPlacement?: (nodes: CanvasLayoutNode[]) => void;
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
    onCanvasFirstPlacement,
    onCanvasLayoutMerge,
    uid,
  } = options;

  const labelSelector = useMemo(
    () => `${BRAIN_PROJECT_ID_LABEL}=${uid}`,
    [uid]
  );
  const templateNativeLabelSelector = useMemo(
    () => `${labelSelector},${BRAIN_RESOURCE_KIND_LABEL}=template`,
    [labelSelector]
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
  const {
    data: templateNativeData,
    error: templateNativeError,
    isLoading: templateNativeLoading,
    mutate: mutateTemplateNative,
  } = useTemplateNativeWorkloads({
    kubeconfig,
    labelSelector: templateNativeLabelSelector,
    namespace,
    refreshInterval: apListRefreshInterval,
  });
  apsListRef.current = apsData;
  dbsListRef.current = dbsData;

  const refreshWorkloadLists = useCallback(() => {
    setWorkloadReconcilePollUntil(
      Date.now() + WORKLOAD_RECONCILE_POLL_WINDOW_MS
    );
    resetWorkloadDiscoveryPollWindow();
    return Promise.all([
      mutateAps(),
      mutateDbs(),
      mutateEntryPoints(),
      mutateTemplateNative(),
    ]);
  }, [
    mutateAps,
    mutateDbs,
    mutateEntryPoints,
    mutateTemplateNative,
    resetWorkloadDiscoveryPollWindow,
  ]);

  const data = useMemo(
    () => ({ aps: apsData, dbs: dbsData, entryPoints: entryPointsData }),
    [apsData, dbsData, entryPointsData]
  );
  const error = apsError ?? dbsError ?? entryPointsError ?? templateNativeError;
  const isLoading =
    apsLoading || dbsLoading || entryPointsLoading || templateNativeLoading;

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
    const apLikeWorkloadKeys = apLikeWorkloadKeysFromList(apsData, {
      namespaceFallback: namespace,
    });
    const templateNativeBlock = templateNativeWorkloadsToCanvasState(
      templateNativeData,
      {
        apLikeWorkloadKeys,
        gridIndexOffset:
          apBlock.nodes.length +
          dbBlock.nodes.length +
          entryPointBlock.nodes.length,
        namespaceFallback: namespace,
      }
    );
    const detectedNodes = [
      ...apBlock.nodes,
      ...dbBlock.nodes,
      ...entryPointBlock.nodes,
      ...templateNativeBlock.nodes,
    ];
    const detectedConnections = canvasLayoutReady
      ? detectCanvasConnections({
          apsData,
          dbsData,
          entryPointsData,
          namespaceFallback: namespace,
        })
      : [];
    const merge = canvasLayoutReady
      ? mergeCanvasLayoutWithDetectedNodes({
          connections: detectedConnections,
          layout: canvasLayout,
          nodes: detectedNodes,
        })
      : {
          changed: false,
          layout: canvasLayout,
          nodes: [],
          placedLayoutNodes: [],
        };
    const edges = canvasLayoutReady
      ? canvasConnectionEdgesFromDetectedConnections(
          detectedConnections,
          merge.nodes
        )
      : [];
    return {
      changed: merge.changed,
      edges: [...edges, ...templateNativeBlock.edges],
      layout: merge.layout,
      nodes: merge.nodes,
      placedLayoutNodes: merge.placedLayoutNodes,
    };
  }, [
    apsData,
    canvasLayout,
    canvasLayoutReady,
    dbsData,
    entryPointsData,
    namespace,
    templateNativeData,
  ]);

  useEffect(() => {
    if (
      isLoading ||
      layoutMerge.placedLayoutNodes.length > 0 ||
      !layoutMerge.changed ||
      layoutMerge.layout === undefined
    ) {
      return;
    }
    onCanvasLayoutMerge?.(layoutMerge.layout.nodes);
  }, [
    isLoading,
    layoutMerge.changed,
    layoutMerge.layout,
    layoutMerge.placedLayoutNodes.length,
    onCanvasLayoutMerge,
  ]);

  useEffect(() => {
    if (isLoading || layoutMerge.placedLayoutNodes.length === 0) {
      return;
    }
    onCanvasFirstPlacement?.(layoutMerge.placedLayoutNodes);
  }, [isLoading, layoutMerge.placedLayoutNodes, onCanvasFirstPlacement]);

  const canvasState = useMemo((): CanvasState => {
    return {
      edges: layoutMerge.edges,
      nodes: layoutMerge.nodes,
      selectedEdge: null,
      selectedNode: null,
    };
  }, [layoutMerge.edges, layoutMerge.nodes]);

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
