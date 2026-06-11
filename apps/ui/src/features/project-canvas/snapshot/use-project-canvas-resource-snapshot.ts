"use client";

import {
  useApsK8sList,
  useDbsK8sList,
  useEntryPointList,
} from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasLayoutDocument } from "@/features/project-canvas/layout/types";
import {
  BRAIN_PROJECT_ID_LABEL,
  BRAIN_RESOURCE_KIND_LABEL,
} from "@/lib/brain-labels";
import { projectCanvasFrameState } from "./project-canvas-page-state";
import {
  entryPointRefreshIntervalForLifecycle,
  workloadListRefreshIntervalForCanvas,
} from "./project-services-refresh";
import {
  buildProjectCanvasResourceSnapshot,
  type ProjectCanvasResourceSnapshot,
} from "./resource-snapshot";
import { useTemplateNativeWorkloads } from "./use-template-native-workloads";

const WORKLOAD_DISCOVERY_POLL_WINDOW_MS = 8000;
const WORKLOAD_RECONCILE_POLL_WINDOW_MS = 30_000;

export function useProjectCanvasResourceSnapshot(options: {
  canvasLayout?: CanvasLayoutDocument;
  canvasLayoutReady?: boolean;
  /** URL-encoded kubeconfig (Authorization bearer body). */
  kubeconfig: string;
  /** K8s namespace for AP, DB, and entrypoint discovery. */
  namespace: string;
  /** Project UID from the route (decoded). */
  uid: string;
}): ProjectCanvasResourceSnapshot & {
  error: Error | undefined;
  /** True only during initial discovery while the graph is still empty. */
  isEmptyGraphLoading: boolean;
  isLoading: boolean;
  /** Refetch Project Canvas resource lists after lifecycle mutations. */
  refresh: () => Promise<unknown>;
} {
  const {
    canvasLayout,
    canvasLayoutReady = true,
    kubeconfig,
    namespace,
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

  const refresh = useCallback(() => {
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

  const error = apsError ?? dbsError ?? entryPointsError ?? templateNativeError;
  const isLoading =
    apsLoading || dbsLoading || entryPointsLoading || templateNativeLoading;

  const snapshot = useMemo(
    () =>
      buildProjectCanvasResourceSnapshot({
        apsData,
        canvasLayout,
        canvasLayoutReady,
        dbsData,
        entryPointsData,
        error,
        isEmptyGraphLoading: false,
        kubeconfig,
        namespace,
        templateNativeData,
      }),
    [
      apsData,
      canvasLayout,
      canvasLayoutReady,
      dbsData,
      entryPointsData,
      error,
      kubeconfig,
      namespace,
      templateNativeData,
    ]
  );
  const graphEmpty =
    snapshot.canvasState.nodes.length === 0 &&
    snapshot.canvasState.edges.length === 0;

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
  // discovery polling may need several more 1 s cycles for K8s to reconcile.
  const [discoveryTimedOut, setDiscoveryTimedOut] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset timer when project changes
  useEffect(() => {
    setDiscoveryTimedOut(false);
    const t = setTimeout(() => setDiscoveryTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [labelSelector]);

  const isEmptyGraphLoading =
    graphEmpty && !hasEverHadNodes.current && !discoveryTimedOut;

  const frameState = useMemo(
    () =>
      projectCanvasFrameState({
        edgeCount: snapshot.canvasState.edges.length,
        error,
        isEmptyGraphLoading,
        kubeconfig,
        nodeCount: snapshot.canvasState.nodes.length,
      }),
    [
      error,
      isEmptyGraphLoading,
      kubeconfig,
      snapshot.canvasState.edges.length,
      snapshot.canvasState.nodes.length,
    ]
  );

  return {
    ...snapshot,
    error,
    frameState,
    isEmptyGraphLoading,
    isLoading,
    refresh,
  };
}
