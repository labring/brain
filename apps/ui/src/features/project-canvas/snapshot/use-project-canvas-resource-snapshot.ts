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
import type { CanvasLayoutDocument } from "@/features/project-canvas/layout/types";
import { useDeploymentTasksStore } from "@/features/project-canvas/runtime/deployment-tasks-store";
import {
  type ProjectCanvasLayoutIntent,
  projectCanvasRuntimeResourceGraph,
} from "@/features/project-canvas/runtime/resource-graph";
import {
  createProjectRuntimeStore,
  type ProjectRuntimeStore,
} from "@/features/project-canvas/runtime/resource-store";
import { BRAIN_PROJECT_ID_LABEL } from "@/lib/brain-labels";
import { useDeadlineNotReached } from "@/lib/use-deadline";
import {
  createMissingResourceGraceStore,
  type MissingResourceGraceStore,
} from "./missing-grace-store";
import { projectCanvasFrameState } from "./project-canvas-page-state";
import {
  type WorkloadTransientSinceByKey,
  workloadListRefreshIntervalForCanvas,
} from "./project-services-refresh";

const WORKLOAD_DISCOVERY_POLL_WINDOW_MS = 8000;
const WORKLOAD_RECONCILE_POLL_WINDOW_MS = 60_000;
// Grace period: `isLoading` clears after the first SWR response, but
// discovery polling may need several more 1 s cycles for K8s to reconcile.
const WORKLOAD_DISCOVERY_TIMEOUT_MS = 8000;

function createTransientSinceMap(): WorkloadTransientSinceByKey {
  return new Map<string, number>();
}

const serverVisibilitySnapshot = () => true;

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
  const [workloadDiscoveryPollUntil, setWorkloadDiscoveryPollUntil] =
    useState(0);
  const [workloadReconcilePollUntil, setWorkloadReconcilePollUntil] =
    useState(0);
  const [discoveryDeadline, setDiscoveryDeadline] = useState(0);
  // Effective visibility also covers being hidden by the Sealos desktop
  // (opacity-0 iframe), which `document.hidden` never reports.
  const isPageVisible = useSyncExternalStore(
    subscribeEffectiveVisibility,
    isEffectivelyVisible,
    serverVisibilitySnapshot
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
  const runtimeStoreKey = JSON.stringify([namespace, uid]);
  const [runtimeEntry, setRuntimeEntry] = useState(() => ({
    grace: createMissingResourceGraceStore(),
    key: runtimeStoreKey,
    store: createProjectRuntimeStore(),
  }));
  if (runtimeEntry.key !== runtimeStoreKey) {
    setRuntimeEntry({
      grace: createMissingResourceGraceStore(),
      key: runtimeStoreKey,
      store: createProjectRuntimeStore(),
    });
  }
  const runtimeStore = runtimeEntry.store;
  const graceStore: MissingResourceGraceStore = runtimeEntry.grace;
  useEffect(() => () => graceStore.dispose(), [graceStore]);
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
    apTransientSinceByKeyRef.current.clear();
    dbTransientSinceByKeyRef.current.clear();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) {
        return;
      }
      const nowMs = Date.now();
      setWorkloadDiscoveryPollUntil(nowMs + WORKLOAD_DISCOVERY_POLL_WINDOW_MS);
      setWorkloadReconcilePollUntil(0);
      setDiscoveryDeadline(nowMs + WORKLOAD_DISCOVERY_TIMEOUT_MS);
    });
    return () => {
      cancelled = true;
    };
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
  useEffect(() => {
    apsListRef.current = apsData;
    dbsListRef.current = dbsData;
  }, [apsData, dbsData]);

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

  useEffect(
    () =>
      subscribeEffectiveVisibility((visible) => {
        if (visible) {
          revalidate().catch(() => undefined);
        }
      }),
    [revalidate]
  );

  const error = apsError ?? dbsError ?? deploymentTasksStore.error;
  const isLoading = apsLoading || dbsLoading || deploymentTasksStore.isLoading;

  const missingResourceLayoutGraceReady =
    canvasLayoutReady &&
    canvasLayout !== undefined &&
    apsData !== undefined &&
    dbsData !== undefined &&
    apsError == null &&
    dbsError == null &&
    !apsLoading &&
    !dbsLoading;
  useEffect(() => {
    runtimeStore.commitResources({
      apsData,
      dbsData,
      namespace,
    });
    // Committed together with the resources so a render never pairs a new
    // topology with a stale grace result (or vice versa).
    graceStore.commit({
      layout: canvasLayout,
      ready: missingResourceLayoutGraceReady,
      resourceIdentities: runtimeStore
        .selectResourceTopology()
        .map((item) => item.ref),
    });
  }, [
    apsData,
    canvasLayout,
    dbsData,
    graceStore,
    missingResourceLayoutGraceReady,
    namespace,
    runtimeStore,
  ]);
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
  const missingLayoutGrace = useSyncExternalStore(
    graceStore.subscribe,
    graceStore.getSnapshot,
    graceStore.getSnapshot
  );

  const graph = useMemo(
    () =>
      projectCanvasRuntimeResourceGraph({
        canvasLayout,
        canvasLayoutReady,
        deployTasks: [...canvasDeployTasks],
        layoutCommands: missingLayoutGrace.deleteCommands,
        now: new Date(missingLayoutGrace.nowMs),
        relationshipIndexes,
        resourceTopology,
        retainedLayoutOwnerKeys: missingLayoutGrace.retainedLayoutOwnerKeys,
      }),
    [
      canvasLayout,
      canvasLayoutReady,
      canvasDeployTasks,
      missingLayoutGrace,
      relationshipIndexes,
      resourceTopology,
    ]
  );
  const graphEmpty =
    graph.canvasState.nodes.length === 0 &&
    graph.canvasState.edges.length === 0;

  // Sticky: once nodes have appeared, never show the bootstrap spinner again.
  // This avoids flicker from `isValidating` oscillating between poll cycles.
  const [everHadNodes, setEverHadNodes] = useState({ uid, value: false });
  if (everHadNodes.uid !== uid) {
    setEverHadNodes({ uid, value: !graphEmpty });
  } else if (!(graphEmpty || everHadNodes.value)) {
    setEverHadNodes({ uid, value: true });
  }

  const discoveryDeadlineNotReached = useDeadlineNotReached(discoveryDeadline);
  const discoveryTimedOut =
    discoveryDeadline !== 0 && !discoveryDeadlineNotReached;

  const isEmptyGraphLoading =
    graphEmpty && !everHadNodes.value && !discoveryTimedOut;

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
