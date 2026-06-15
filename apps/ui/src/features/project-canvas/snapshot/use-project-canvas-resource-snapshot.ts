"use client";

import { useApsK8sList, useDbsK8sList } from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasLayoutDocument } from "@/features/project-canvas/layout/types";
import {
  BRAIN_DEPLOYMENT_KIND_LABEL,
  BRAIN_PROJECT_ID_LABEL,
} from "@/lib/brain-labels";
import {
  fetchProjectDeploymentTaskProjections,
  streamProjectDeploymentTaskProjections,
} from "@/lib/deploy-task/client";
import {
  type DeploymentTaskProjection,
  deploymentTaskProjectionIsVisible,
  upsertDeploymentTaskProjection,
} from "@/lib/deploy-task/projection";
import { projectCanvasFrameState } from "./project-canvas-page-state";
import {
  type WorkloadTransientSinceByKey,
  workloadListRefreshIntervalForCanvas,
} from "./project-services-refresh";
import {
  buildProjectCanvasResourceSnapshot,
  type ProjectCanvasResourceSnapshot,
} from "./resource-snapshot";
import { useTemplateNativeWorkloads } from "./use-template-native-workloads";

const WORKLOAD_DISCOVERY_POLL_WINDOW_MS = 8000;
const WORKLOAD_RECONCILE_POLL_WINDOW_MS = 60_000;
const DEPLOYMENT_PROJECTION_RECONNECT_MS = 3000;

function createTransientSinceMap(): WorkloadTransientSinceByKey {
  return new Map<string, number>();
}

export function useProjectCanvasResourceSnapshot(options: {
  canvasLayout?: CanvasLayoutDocument;
  canvasLayoutReady?: boolean;
  /** URL-encoded kubeconfig (Authorization bearer body). */
  kubeconfig: string;
  /** K8s namespace for AP, DB, and public access discovery. */
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
    () => `${labelSelector},${BRAIN_DEPLOYMENT_KIND_LABEL}=template`,
    [labelSelector]
  );

  const apsListRef = useRef<K8sGetResponse | undefined>(undefined);
  const dbsListRef = useRef<K8sGetResponse | undefined>(undefined);
  const apTransientSinceByKeyRef = useRef(createTransientSinceMap());
  const dbTransientSinceByKeyRef = useRef(createTransientSinceMap());
  const deploymentTransientSinceByKeyRef = useRef(createTransientSinceMap());
  const statefulSetTransientSinceByKeyRef = useRef(createTransientSinceMap());
  const [workloadDiscoveryPollUntil, setWorkloadDiscoveryPollUntil] =
    useState(0);
  const [workloadReconcilePollUntil, setWorkloadReconcilePollUntil] =
    useState(0);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [deployTasks, setDeployTasks] = useState<DeploymentTaskProjection[]>(
    []
  );
  const [deployTasksLoading, setDeployTasksLoading] = useState(false);
  const [deployTasksError, setDeployTasksError] = useState<Error | undefined>(
    undefined
  );
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
    (
      latestData: K8sGetResponse | undefined,
      peerEmpty: () => boolean,
      resourceKind: string,
      transientSinceByKey: WorkloadTransientSinceByKey
    ) =>
      workloadListRefreshIntervalForCanvas({
        discoveryPollUntil: workloadDiscoveryPollUntil,
        fallbackNamespace: namespace,
        isPageVisible,
        latestData,
        peerEmpty: peerEmpty(),
        resourceKind,
        transientSinceByKey,
        workloadReconcilePollUntil,
      }),
    [
      isPageVisible,
      namespace,
      workloadDiscoveryPollUntil,
      workloadReconcilePollUntil,
    ]
  );
  const apListRefreshInterval = useCallback(
    (latestData: K8sGetResponse | undefined) =>
      workloadListRefreshInterval(
        latestData,
        peerDbsEmpty,
        "ap",
        apTransientSinceByKeyRef.current
      ),
    [peerDbsEmpty, workloadListRefreshInterval]
  );
  const dbListRefreshInterval = useCallback(
    (latestData: K8sGetResponse | undefined) =>
      workloadListRefreshInterval(
        latestData,
        peerApsEmpty,
        "db",
        dbTransientSinceByKeyRef.current
      ),
    [peerApsEmpty, workloadListRefreshInterval]
  );
  const deploymentListRefreshInterval = useCallback(
    (latestData: K8sGetResponse | undefined) =>
      workloadListRefreshInterval(
        latestData,
        peerDbsEmpty,
        "deployment",
        deploymentTransientSinceByKeyRef.current
      ),
    [peerDbsEmpty, workloadListRefreshInterval]
  );
  const statefulSetListRefreshInterval = useCallback(
    (latestData: K8sGetResponse | undefined) =>
      workloadListRefreshInterval(
        latestData,
        peerDbsEmpty,
        "statefulset",
        statefulSetTransientSinceByKeyRef.current
      ),
    [peerDbsEmpty, workloadListRefreshInterval]
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset discovery polling when project changes
  useEffect(() => {
    resetWorkloadDiscoveryPollWindow();
    setWorkloadReconcilePollUntil(0);
    apTransientSinceByKeyRef.current.clear();
    dbTransientSinceByKeyRef.current.clear();
    deploymentTransientSinceByKeyRef.current.clear();
    statefulSetTransientSinceByKeyRef.current.clear();
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
  const {
    data: templateNativeData,
    error: templateNativeError,
    isLoading: templateNativeLoading,
    mutate: mutateTemplateNative,
  } = useTemplateNativeWorkloads({
    kubeconfig,
    labelSelector: templateNativeLabelSelector,
    namespace,
    deploymentsRefreshInterval: deploymentListRefreshInterval,
    statefulSetsRefreshInterval: statefulSetListRefreshInterval,
  });
  apsListRef.current = apsData;
  dbsListRef.current = dbsData;

  const refreshWorkloadResources = useCallback(
    () => Promise.all([mutateAps(), mutateDbs(), mutateTemplateNative()]),
    [mutateAps, mutateDbs, mutateTemplateNative]
  );
  const refreshWorkloadResourcesRef = useRef(refreshWorkloadResources);
  useEffect(() => {
    refreshWorkloadResourcesRef.current = refreshWorkloadResources;
  }, [refreshWorkloadResources]);
  const requestWorkloadReconciliation = useCallback(() => {
    setWorkloadReconcilePollUntil(
      Date.now() + WORKLOAD_RECONCILE_POLL_WINDOW_MS
    );
    refreshWorkloadResourcesRef.current().catch(() => undefined);
  }, []);

  const refreshDeployTasks = useCallback(async () => {
    if (
      kubeconfig.trim() === "" ||
      namespace.trim() === "" ||
      uid.trim() === ""
    ) {
      setDeployTasks([]);
      setDeployTasksLoading(false);
      setDeployTasksError(undefined);
      return [];
    }
    setDeployTasksLoading(true);
    try {
      const projections = await fetchProjectDeploymentTaskProjections({
        kubeconfig,
        namespace,
        projectId: uid,
      });
      setDeployTasks(projections);
      setDeployTasksError(undefined);
      return projections;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setDeployTasksError(err);
      throw err;
    } finally {
      setDeployTasksLoading(false);
    }
  }, [kubeconfig, namespace, uid]);

  useEffect(() => {
    let cancelled = false;
    setDeployTasks([]);
    setDeployTasksError(undefined);

    if (
      kubeconfig.trim() === "" ||
      namespace.trim() === "" ||
      uid.trim() === ""
    ) {
      setDeployTasksLoading(false);
      return;
    }

    setDeployTasksLoading(true);
    fetchProjectDeploymentTaskProjections({
      kubeconfig,
      namespace,
      projectId: uid,
    })
      .then((projections) => {
        if (cancelled) {
          return;
        }
        setDeployTasks(projections);
        setDeployTasksError(undefined);
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setDeployTasksError(
          error instanceof Error ? error : new Error(String(error))
        );
      })
      .finally(() => {
        if (!cancelled) {
          setDeployTasksLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [kubeconfig, namespace, uid]);

  useEffect(() => {
    if (
      !isPageVisible ||
      kubeconfig.trim() === "" ||
      namespace.trim() === "" ||
      uid.trim() === ""
    ) {
      return;
    }

    let reconnectTimer: number | undefined;
    const controller = new AbortController();
    const connect = () => {
      streamProjectDeploymentTaskProjections({
        kubeconfig,
        namespace,
        onEvent: (event) => {
          setDeployTasksError(undefined);
          if (event.type === "snapshot") {
            setDeployTasks(event.projections);
            if (event.projections.length > 0) {
              requestWorkloadReconciliation();
            }
            return;
          }
          if (event.type === "upsert") {
            setDeployTasks((current) =>
              upsertDeploymentTaskProjection(current, event.projection)
            );
            requestWorkloadReconciliation();
            return;
          }
          if (event.type === "remove") {
            setDeployTasks((current) =>
              current.filter((task) => task.id !== event.taskId)
            );
            requestWorkloadReconciliation();
          }
        },
        projectId: uid,
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setDeployTasksError(
          error instanceof Error ? error : new Error(String(error))
        );
        reconnectTimer = window.setTimeout(
          connect,
          DEPLOYMENT_PROJECTION_RECONNECT_MS
        );
      });
    };

    connect();
    return () => {
      controller.abort();
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [
    isPageVisible,
    kubeconfig,
    namespace,
    requestWorkloadReconciliation,
    uid,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDeployTasks((current) =>
        current.filter((task) => deploymentTaskProjectionIsVisible(task))
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const revalidate = useCallback(() => {
    return Promise.all([refreshWorkloadResources(), refreshDeployTasks()]);
  }, [refreshDeployTasks, refreshWorkloadResources]);

  const refresh = useCallback(() => {
    setWorkloadReconcilePollUntil(
      Date.now() + WORKLOAD_RECONCILE_POLL_WINDOW_MS
    );
    resetWorkloadDiscoveryPollWindow();
    return revalidate();
  }, [revalidate, resetWorkloadDiscoveryPollWindow]);

  useEffect(() => {
    const nextIsPageVisible =
      typeof document === "undefined" ? true : !document.hidden;
    setIsPageVisible(nextIsPageVisible);

    const onVisibilityChange = () => {
      const visible = !document.hidden;
      setIsPageVisible(visible);
      if (visible) {
        revalidate().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [revalidate]);

  const error = apsError ?? dbsError ?? templateNativeError ?? deployTasksError;
  const isLoading =
    apsLoading || dbsLoading || templateNativeLoading || deployTasksLoading;

  const snapshot = useMemo(
    () =>
      buildProjectCanvasResourceSnapshot({
        apsData,
        canvasLayout,
        canvasLayoutReady,
        dbsData,
        deployTasks,
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
      deployTasks,
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
