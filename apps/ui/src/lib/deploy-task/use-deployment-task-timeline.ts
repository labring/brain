"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

import {
  fetchDeploymentTaskTimeline,
  streamDeploymentTaskTimeline,
} from "./client";
import { applyDeploymentTaskTimelineSnapshot } from "./timeline-client-state";
import type { DeploymentTaskTimelineSnapshotDTO } from "./types";

const STREAM_RECONNECT_DELAY_MS = 1500;

export interface UseDeploymentTaskTimelineInput {
  enabled?: boolean;
  kubeconfig: string;
  namespace: string;
  taskId: string | null;
}

export interface UseDeploymentTaskTimelineState {
  data: DeploymentTaskTimelineSnapshotDTO | null;
  error: Error | null;
  isLoading: boolean;
  isReconnecting: boolean;
}

interface TimelineEffectSetters {
  setData: Dispatch<SetStateAction<DeploymentTaskTimelineSnapshotDTO | null>>;
  setError: Dispatch<SetStateAction<Error | null>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setIsReconnecting: Dispatch<SetStateAction<boolean>>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timelineError(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

async function loadInitialTimeline(input: {
  kubeconfig: string;
  namespace: string;
  setters: TimelineEffectSetters;
  signal: AbortSignal;
  taskId: string;
}) {
  input.setters.setIsLoading(true);
  input.setters.setError(null);
  try {
    const snapshot = await fetchDeploymentTaskTimeline({
      kubeconfig: input.kubeconfig,
      namespace: input.namespace,
      taskId: input.taskId,
    });
    if (!input.signal.aborted) {
      input.setters.setData((current) =>
        applyDeploymentTaskTimelineSnapshot(current, snapshot)
      );
    }
  } catch (error) {
    if (!input.signal.aborted) {
      input.setters.setError(
        timelineError(error, "Could not load deployment task timeline.")
      );
    }
  } finally {
    if (!input.signal.aborted) {
      input.setters.setIsLoading(false);
    }
  }
}

async function streamTimelineUntilAbort(input: {
  kubeconfig: string;
  namespace: string;
  setters: TimelineEffectSetters;
  signal: AbortSignal;
  taskId: string;
}) {
  while (!input.signal.aborted) {
    try {
      input.setters.setIsReconnecting(false);
      await streamDeploymentTaskTimeline({
        kubeconfig: input.kubeconfig,
        namespace: input.namespace,
        onEvent: (event) => {
          input.setters.setData((current) =>
            applyDeploymentTaskTimelineSnapshot(current, event.snapshot)
          );
          input.setters.setError(null);
        },
        signal: input.signal,
        taskId: input.taskId,
      });
    } catch (error) {
      if (input.signal.aborted) {
        return;
      }
      input.setters.setError(
        timelineError(error, "Deployment task timeline stream failed.")
      );
      input.setters.setIsReconnecting(true);
      await sleep(STREAM_RECONNECT_DELAY_MS);
    }
  }
}

export function useDeploymentTaskTimeline(
  input: UseDeploymentTaskTimelineInput
): UseDeploymentTaskTimelineState {
  const enabled =
    input.enabled !== false &&
    input.taskId != null &&
    input.taskId.trim() !== "" &&
    input.kubeconfig.trim() !== "";
  const [data, setData] = useState<DeploymentTaskTimelineSnapshotDTO | null>(
    null
  );
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (!enabled || input.taskId == null) {
      setData(null);
      setError(null);
      setIsLoading(false);
      setIsReconnecting(false);
      return;
    }

    const controller = new AbortController();
    const taskId = input.taskId;
    const setters: TimelineEffectSetters = {
      setData,
      setError,
      setIsLoading,
      setIsReconnecting,
    };

    async function run() {
      await loadInitialTimeline({
        kubeconfig: input.kubeconfig,
        namespace: input.namespace,
        setters,
        signal: controller.signal,
        taskId,
      });
      await streamTimelineUntilAbort({
        kubeconfig: input.kubeconfig,
        namespace: input.namespace,
        setters,
        signal: controller.signal,
        taskId,
      });
    }

    run().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setError(timelineError(error, "Deployment task timeline failed."));
      }
    });

    return () => {
      controller.abort();
    };
  }, [enabled, input.kubeconfig, input.namespace, input.taskId]);

  return { data, error, isLoading, isReconnecting };
}
