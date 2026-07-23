"use client";

import { useApsK8sList, useDbsK8sList } from "@workspace/api/hooks";
import { apItemsFromList } from "@workspace/api/lib/ap-list";
import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { CanvasState } from "@workspace/ui/components/canvas/canvas.types";
import {
  isEffectivelyVisible,
  subscribeEffectiveVisibility,
} from "@workspace/ui/lib/effective-visibility";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import { CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS } from "@/features/project-canvas/layout/missing-resource-grace";
import type { CanvasLayoutDocument } from "@/features/project-canvas/layout/types";
import { useDeploymentTasksStore } from "@/features/project-canvas/runtime/deployment-tasks-store";
import type { ProjectCanvasLayoutIntent } from "@/features/project-canvas/runtime/resource-graph";
import {
  createProjectRuntimeStore,
  type ProjectRuntimeStore,
} from "@/features/project-canvas/runtime/resource-store";
import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import { projectCanvasFrameState } from "./project-canvas-page-state";
import {
  type WorkloadTransientSinceByKey,
  workloadListRefreshIntervalForCanvas,
} from "./project-services-refresh";
import { projectCanvasResourceSnapshotFrame } from "./resource-snapshot-frame";

const WORKLOAD_DISCOVERY_POLL_WINDOW_MS = 8000;
const WORKLOAD_RECONCILE_POLL_WINDOW_MS = 60_000;
function createTransientSinceMap(): WorkloadTransientSinceByKey {
  return new Map<string, number>();
}

function nextMissingResourceGraceDelayMs(
  missingSinceByOwnerKey: ReadonlyMap<string, number>,
  retainedOwnerKeys: ReadonlySet<string>,
  nowMs: number
): number | undefined {
  let nextDelay: number | undefined;
  for (const ownerKey of retainedOwnerKeys) {
    const firstMissingAt = missingSinceByOwnerKey.get(ownerKey);
    if (firstMissingAt === undefined) {
      continue;
    }
    const delay = Math.max(
      0,
      firstMissingAt + CANVAS_MISSING_RESOURCE_LAYOUT_GRACE_MS - nowMs
    );
    nextDelay = nextDelay === undefined ? delay : Math.min(nextDelay, delay);
  }
  return nextDelay;
}

interface ProjectCanvasResourceRuntimeState {
  apEnvironmentDbReferenceSources: ReturnType<
    ProjectRuntimeStore["selectRelationshipIndexes"]
  >["apEnvironmentDbReferenceSources"];
  canvasState: CanvasState;
  frameState: ReturnType<typeof projectCanvasFrameState>;
  layoutIntent: ProjectCanvasLayoutIntent | null;
  runtimeStore: ProjectRuntimeStore;
}

export function useProjectCanvasResourceSnapshot(options: {
  canvasLayout?: CanvasLayoutDocument;
  canvasLayoutReady?: boolean;
  /**
   * Reads whether a full-coverage surface currently hides the canvas.
   * Evaluated at poll-scheduling time so covered canvases drop to
   * background cadence without re-rendering the hook.
   */
  isCanvasCovered?: () => boolean;
  /** URL-encoded kubeconfig (Authorization bearer body). */
  kubeconfig: string;
  /** K8s namespace for AP, DB, and public access discovery. */
  namespace: string;
  /** Project UID from the route (decoded). */
  uid: string;
}): ProjectCanvasResourceRuntimeState & {
  deploymentTaskProjections: DeploymentTaskProjection[];
  error: Error | undefined;
  /** True only during initial discovery while the graph is still empty. */
  isEmptyGraphLoading: boolean;
  isLoading: boolean;
  /** Refetch Project Canvas resource lists after lifecycle mutations. */
  refresh: () => Promise<unknown>;
  /** Revalidates resource lists and deployment projections without opening poll windows. */
  revalidate: () => Promise<unknown>;
} {
  const {
    canvasLayout,
    canvasLayoutReady = true,
    isCanvasCovered,
    kubeconfig,
    namespace,
    uid,
  } = options;

  const labelSelector = useMemo(
    () => `${BRAIN_PROJECT_ID_LABEL}=${uid}`,
    [uid]
  );
  const apsListRef = useRef<K8sGetResponse | undefined>(undefined);
  const dbsListRef = useRef<K8sGetResponse | undefined>(undefined);
  const apTransientSinceByKeyRef = useRef(createTransientSinceMap());
  const dbTransientSinceByKeyRef = useRef(createTransientSinceMap());
  const missingLayoutSinceByOwnerKeyRef = useRef(new Map<string, number>());
  const [missingLayoutGraceClock, setMissingLayoutGraceClock] = useState(0);
  const [workloadDiscoveryPollUntil, setWorkloadDiscoveryPollUntil] =
    useState(0);
  const [workloadReconcilePollUntil, setWorkloadReconcilePollUntil] =
    useState(0);
  const [isPageVisible, setIsPageVisible] = useState(true);
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
  const runtimeStoreKey = JSON.stringify([namespace, uid]);
  const runtimeStoreRef = useRef<{
    key: string;
    store: ProjectRuntimeStore;
  } | null>(null);
  if (runtimeStoreRef.current?.key !== runtimeStoreKey) {
    runtimeStoreRef.current = {
      key: runtimeStoreKey,
      store: createProjectRuntimeStore(),
    };
  }
  const runtimeStore = runtimeStoreRef.current.store;
  const workloadListRefreshInterval = useCallback(
    (
      latestData: K8sGetResponse | undefined,
      peerEmpty: () => boolean,
      resourceKind: string,
      transientSinceByKey: WorkloadTransientSinceByKey
    ) =>
      workloadListRefreshIntervalForCanvas({
        canvasCovered: isCanvasCovered?.() ?? false,
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
      isCanvasCovered,
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset discovery polling when project changes
  useEffect(() => {
    resetWorkloadDiscoveryPollWindow();
    setWorkloadReconcilePollUntil(0);
    apTransientSinceByKeyRef.current.clear();
    dbTransientSinceByKeyRef.current.clear();
    missingLayoutSinceByOwnerKeyRef.current.clear();
  }, [labelSelector, resetWorkloadDiscoveryPollWindow]);

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
  apsListRef.current = apsData;
  dbsListRef.current = dbsData;

  const refreshWorkloadResources = useCallback(
    () => Promise.all([mutateAps(), mutateDbs()]),
    [mutateAps, mutateDbs]
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
  const deploymentTasksStore = useDeploymentTasksStore({
    enabled: isPageVisible,
    kubeconfig,
    namespace,
    onCanvasTopologyChanged: requestWorkloadReconciliation,
    projectId: uid,
  });
  const canvasDeployTasks = deploymentTasksStore.canvasProjections;

  const refreshDeploymentTasks = deploymentTasksStore.refresh;
  const revalidate = useCallback(() => {
    return Promise.all([refreshWorkloadResources(), refreshDeploymentTasks()]);
  }, [refreshDeploymentTasks, refreshWorkloadResources]);

  const refresh = useCallback(() => {
    setWorkloadReconcilePollUntil(
      Date.now() + WORKLOAD_RECONCILE_POLL_WINDOW_MS
    );
    resetWorkloadDiscoveryPollWindow();
    return revalidate();
  }, [revalidate, resetWorkloadDiscoveryPollWindow]);

  useEffect(() => {
    // Effective visibility also covers being hidden by the Sealos desktop
    // (opacity-0 iframe), which `document.hidden` never reports.
    setIsPageVisible(isEffectivelyVisible());
    return subscribeEffectiveVisibility((visible) => {
      setIsPageVisible(visible);
      if (visible) {
        revalidate().catch(() => undefined);
      }
    });
  }, [revalidate]);

  const error = apsError ?? dbsError ?? deploymentTasksStore.error;
  const isLoading = apsLoading || dbsLoading || deploymentTasksStore.isLoading;

  useEffect(() => {
    runtimeStore.commitResources({
      apsData,
      dbsData,
      namespace,
    });
  }, [apsData, dbsData, namespace, runtimeStore]);
  const resourceTopology = useSyncExternalStore(
    runtimeStore.subscribeResourceTopology,
    runtimeStore.selectResourceTopology,
    runtimeStore.selectResourceTopology
  );
  const relationshipIndexes = useSyncExternalStore(
    runtimeStore.subscribeRelationshipIndexes,
    runtimeStore.selectRelationshipIndexes,
    runtimeStore.selectRelationshipIndexes
  );
  const apEnvironmentDbReferenceSources =
    relationshipIndexes.apEnvironmentDbReferenceSources;

  const missingResourceLayoutGraceReady =
    canvasLayoutReady &&
    canvasLayout !== undefined &&
    apsData !== undefined &&
    dbsData !== undefined &&
    apsError == null &&
    dbsError == null &&
    !apsLoading &&
    !dbsLoading;
  const snapshotFrame = useMemo(
    () =>
      projectCanvasResourceSnapshotFrame({
        canvasLayout,
        canvasLayoutReady,
        deployTasks: canvasDeployTasks,
        missingResourceLayoutGraceReady,
        nowMs: Math.max(Date.now(), missingLayoutGraceClock),
        previousMissingSinceByOwnerKey: missingLayoutSinceByOwnerKeyRef.current,
        relationshipIndexes,
        resourceTopology,
      }),
    [
      canvasLayout,
      canvasLayoutReady,
      canvasDeployTasks,
      missingLayoutGraceClock,
      missingResourceLayoutGraceReady,
      relationshipIndexes,
      resourceTopology,
    ]
  );
  const missingResourceLayoutGrace = snapshotFrame.missingResourceLayoutGrace;
  useEffect(() => {
    if (!missingResourceLayoutGraceReady) {
      return;
    }
    missingLayoutSinceByOwnerKeyRef.current =
      missingResourceLayoutGrace.nextMissingSinceByOwnerKey;
    const nextDelay = nextMissingResourceGraceDelayMs(
      missingResourceLayoutGrace.nextMissingSinceByOwnerKey,
      missingResourceLayoutGrace.retainedLayoutOwnerKeys,
      snapshotFrame.nowMs
    );
    if (nextDelay === undefined) {
      return;
    }
    const timer = window.setTimeout(
      () => setMissingLayoutGraceClock(Date.now()),
      nextDelay + 25
    );
    return () => window.clearTimeout(timer);
  }, [
    missingResourceLayoutGrace,
    missingResourceLayoutGraceReady,
    snapshotFrame.nowMs,
  ]);
  const graph = snapshotFrame.graph;
  const graphEmpty =
    graph.canvasState.nodes.length === 0 &&
    graph.canvasState.edges.length === 0;

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
        edgeCount: graph.canvasState.edges.length,
        error,
        isEmptyGraphLoading,
        kubeconfig,
        nodeCount: graph.canvasState.nodes.length,
      }),
    [
      error,
      isEmptyGraphLoading,
      kubeconfig,
      graph.canvasState.edges.length,
      graph.canvasState.nodes.length,
    ]
  );

  return {
    apEnvironmentDbReferenceSources,
    canvasState: graph.canvasState,
    deploymentTaskProjections: deploymentTasksStore.projections,
    error,
    frameState,
    isEmptyGraphLoading,
    isLoading,
    layoutIntent: graph.layoutIntent,
    refresh,
    revalidate,
    runtimeStore,
  };
}
