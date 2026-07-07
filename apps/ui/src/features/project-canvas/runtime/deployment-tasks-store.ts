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

const DEPLOYMENT_PROJECTION_RECONNECT_MS = 4000;

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
  const canvasProjectionsRef = useRef<DeploymentTaskProjection[]>([]);
  const [visibilityNow, setVisibilityNow] = useState(() => new Date());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const topologyChangedRef = useRef(onCanvasTopologyChanged);
  useEffect(() => {
    topologyChangedRef.current = onCanvasTopologyChanged;
  }, [onCanvasTopologyChanged]);

  const commit = useCallback((next: DeploymentTaskProjection[]) => {
    const current = projectionsRef.current;
    if (next === current) {
      return;
    }
    const canvasTopologyChanged = deploymentTaskCanvasTopologyChanged({
      current,
      next,
    });
    projectionsRef.current = next;
    setProjections(next);
    if (canvasTopologyChanged) {
      topologyChangedRef.current?.();
    }
  }, []);

  const handleEvent = useCallback(
    (event: DeploymentTaskProjectionStreamEvent) => {
      setError(undefined);
      const current = projectionsRef.current;
      switch (event.type) {
        case "snapshot":
          commit(replaceDeploymentTaskProjections(current, event.projections));
          return;
        case "upsert":
          commit(upsertDeploymentTaskProjection(current, event.projection));
          return;
        case "remove":
          commit(current.filter((task) => task.id !== event.taskId));
          return;
        default:
          event satisfies never;
      }
    },
    [commit]
  );

  const refresh = useCallback(async () => {
    if (!hasScope) {
      commit([]);
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
      commit(replaceDeploymentTaskProjections(projectionsRef.current, fetched));
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
  }, [commit, hasScope, kubeconfig, namespace, projectId]);

  useEffect(() => {
    let cancelled = false;
    commit([]);
    setError(undefined);
    if (!hasScope) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    fetchProjectDeploymentTaskProjections({ kubeconfig, namespace, projectId })
      .then((fetched) => {
        if (!cancelled) {
          commit(replaceDeploymentTaskProjections([], fetched));
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
  }, [commit, hasScope, kubeconfig, namespace, projectId]);

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
