"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchProjectDeploymentTaskProjections,
  streamProjectDeploymentTaskProjections,
} from "@/lib/deploy-task/client";
import {
  type DeploymentTaskProjection,
  type DeploymentTaskProjectionStreamEvent,
  deploymentTaskCanvasTopologyChanged,
  nextDeploymentTaskProjectionVisibilityChangeMs,
  replaceDeploymentTaskProjections,
  selectCanvasDeploymentTaskProjections,
  upsertDeploymentTaskProjection,
} from "@/lib/deploy-task/projection";
import {
  createThrottleScheduler,
  type ThrottleScheduler,
} from "@/lib/throttle-scheduler";

const DEPLOYMENT_PROJECTION_RECONNECT_MS = 4000;
/** Coalesce the projection-delta storm to at most one React commit per window (ADR 0043). */
const DEPLOYMENT_PROJECTION_COALESCE_MS = 200;

export interface DeploymentTasksStore {
  /** Projections filtered for canvas presence (grace windows applied). */
  canvasProjections: DeploymentTaskProjection[];
  error: Error | undefined;
  isLoading: boolean;
  /** Every projectable task for this project (dock, timeline, actions). */
  projections: DeploymentTaskProjection[];
  refresh: () => Promise<DeploymentTaskProjection[]>;
}

/**
 * The single UI read point for deployment tasks (ADR 0037/PRD #162):
 * bootstrap read plus the projection stream, with memoized visibility
 * selection. Owning this state here fixes the stale-task retention and
 * cross-project leakage the canvas snapshot hook accumulated.
 */
export function useDeploymentTasksStore(options: {
  enabled: boolean;
  kubeconfig: string;
  namespace: string;
  /** Canvas topology changes need a workload list reconciliation. */
  onCanvasTopologyChanged?: () => void;
  projectId: string;
}): DeploymentTasksStore {
  const { enabled, kubeconfig, namespace, onCanvasTopologyChanged, projectId } =
    options;
  const hasScope =
    kubeconfig.trim() !== "" &&
    namespace.trim() !== "" &&
    projectId.trim() !== "";

  const [projections, setProjections] = useState<DeploymentTaskProjection[]>(
    []
  );
  const projectionsRef = useRef<DeploymentTaskProjection[]>([]);
  const publishedRef = useRef<DeploymentTaskProjection[]>([]);
  const canvasProjectionsRef = useRef<DeploymentTaskProjection[]>([]);
  const [visibilityNow, setVisibilityNow] = useState(() => new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const topologyChangedRef = useRef(onCanvasTopologyChanged);
  useEffect(() => {
    topologyChangedRef.current = onCanvasTopologyChanged;
  }, [onCanvasTopologyChanged]);

  // Hand whatever is folded into projectionsRef to React, firing the topology
  // callback if the canvas-relevant shape changed since the last publish.
  // Diffing published-vs-next (not per event) means intra-window flaps no longer
  // trigger spurious workload reconciliations.
  const publish = useCallback(() => {
    const next = projectionsRef.current;
    const previous = publishedRef.current;
    if (next === previous) {
      return;
    }
    const canvasTopologyChanged = deploymentTaskCanvasTopologyChanged({
      current: previous,
      next,
    });
    publishedRef.current = next;
    setProjections(next);
    if (canvasTopologyChanged) {
      topologyChangedRef.current?.();
    }
  }, []);

  // Coalesce the projection-delta storm: many resources emit a burst of events,
  // and publishing each one re-renders the whole canvas subtree and rebuilds the
  // resource graph (ADR 0043). Fold every event into projectionsRef immediately
  // but publish at most once per DEPLOYMENT_PROJECTION_COALESCE_MS.
  const schedulerRef = useRef<ThrottleScheduler | null>(null);
  if (schedulerRef.current === null) {
    schedulerRef.current = createThrottleScheduler(
      DEPLOYMENT_PROJECTION_COALESCE_MS,
      publish
    );
  }
  useEffect(() => () => schedulerRef.current?.cancel(), []);

  // Bootstrap/refresh/reset are not part of the stream storm: publish now.
  const commitNow = useCallback(
    (next: DeploymentTaskProjection[]) => {
      if (next === projectionsRef.current) {
        return;
      }
      projectionsRef.current = next;
      publish();
    },
    [publish]
  );

  // Stream deltas: fold now, hand to React on the throttle cadence.
  const commitStreamed = useCallback((next: DeploymentTaskProjection[]) => {
    if (next === projectionsRef.current) {
      return;
    }
    projectionsRef.current = next;
    schedulerRef.current?.schedule();
  }, []);

  const handleEvent = useCallback(
    (event: DeploymentTaskProjectionStreamEvent) => {
      setError(undefined);
      const current = projectionsRef.current;
      switch (event.type) {
        case "snapshot":
          commitStreamed(
            replaceDeploymentTaskProjections(current, event.projections)
          );
          return;
        case "upsert":
          commitStreamed(
            upsertDeploymentTaskProjection(current, event.projection)
          );
          return;
        case "remove":
          commitStreamed(current.filter((task) => task.id !== event.taskId));
          return;
        default:
          event satisfies never;
      }
    },
    [commitStreamed]
  );

  const refresh = useCallback(async () => {
    if (!hasScope) {
      commitNow([]);
      setIsLoading(false);
      setError(undefined);
      return [];
    }
    setIsLoading(true);
    try {
      const fetched = await fetchProjectDeploymentTaskProjections({
        kubeconfig,
        namespace,
        projectId,
      });
      commitNow(
        replaceDeploymentTaskProjections(projectionsRef.current, fetched)
      );
      setError(undefined);
      return fetched;
    } catch (refreshError) {
      const err =
        refreshError instanceof Error
          ? refreshError
          : new Error(String(refreshError));
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [commitNow, hasScope, kubeconfig, namespace, projectId]);

  useEffect(() => {
    let cancelled = false;
    commitNow([]);
    setError(undefined);
    if (!hasScope) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchProjectDeploymentTaskProjections({ kubeconfig, namespace, projectId })
      .then((fetched) => {
        if (!cancelled) {
          commitNow(replaceDeploymentTaskProjections([], fetched));
          setError(undefined);
        }
      })
      .catch((bootstrapError: unknown) => {
        if (!cancelled) {
          setError(
            bootstrapError instanceof Error
              ? bootstrapError
              : new Error(String(bootstrapError))
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [commitNow, hasScope, kubeconfig, namespace, projectId]);

  useEffect(() => {
    if (!(enabled && hasScope)) {
      return;
    }
    let reconnectTimer: number | undefined;
    const controller = new AbortController();
    const connect = () => {
      streamProjectDeploymentTaskProjections({
        kubeconfig,
        namespace,
        onEvent: handleEvent,
        projectId,
        signal: controller.signal,
      }).catch((streamError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(
          streamError instanceof Error
            ? streamError
            : new Error(String(streamError))
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
  }, [enabled, handleEvent, hasScope, kubeconfig, namespace, projectId]);

  useEffect(() => {
    const nextDelay =
      nextDeploymentTaskProjectionVisibilityChangeMs(projections);
    if (nextDelay === undefined) {
      return;
    }
    const timer = window.setTimeout(() => {
      setVisibilityNow(new Date());
    }, nextDelay + 25);
    return () => window.clearTimeout(timer);
  }, [projections]);

  const canvasProjections = useMemo(
    () =>
      selectCanvasDeploymentTaskProjections({
        current: canvasProjectionsRef.current,
        now: visibilityNow,
        projections,
      }),
    [visibilityNow, projections]
  );
  useEffect(() => {
    canvasProjectionsRef.current = canvasProjections;
  }, [canvasProjections]);

  return { canvasProjections, error, isLoading, projections, refresh };
}
