"use client";

import { useAtomValue } from "jotai";
import { useCallback, useRef, useState } from "react";

import { appTokenAtom } from "@/lib/auth-store";
import {
  cancelDeploymentTask,
  type DeployTaskActionResult,
  redeployDeploymentTask,
} from "./client";

export interface DeploymentTaskActions {
  cancel: (taskId: string) => Promise<DeployTaskActionResult>;
  /** Optimistic "cancelling" bridge until the stream carries the truth. */
  cancelPendingTaskIds: ReadonlySet<string>;
  redeploy: (predecessorTaskId: string) => Promise<DeployTaskActionResult>;
  redeployPendingTaskIds: ReadonlySet<string>;
}

/**
 * The one client actions module for deployment tasks (PRD #162): cancel and
 * redeploy with in-flight tracking; `cancelRequestedAt` from the stream is
 * the truth once the round-trip lands, and 409s resolve to the returned
 * snapshot instead of error toasts.
 */
export function useDeploymentTaskActions(input: {
  kubeconfig: string;
  namespace: string;
}): DeploymentTaskActions {
  const { kubeconfig, namespace } = input;
  // Redeploy always proves the initiator because it may bind personal source
  // credentials or inherited user attribution.
  const appToken = useAtomValue(appTokenAtom);
  const [cancelPendingTaskIds, setCancelPendingTaskIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [redeployPendingTaskIds, setRedeployPendingTaskIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const inFlightRef = useRef(new Set<string>());

  const track = useCallback(
    (
      setter: (updater: (current: ReadonlySet<string>) => Set<string>) => void,
      taskId: string,
      present: boolean
    ) => {
      setter((current) => {
        const next = new Set(current);
        if (present) {
          next.add(taskId);
        } else {
          next.delete(taskId);
        }
        return next;
      });
    },
    []
  );

  const cancel = useCallback(
    async (taskId: string) => {
      const flightKey = `cancel:${taskId}`;
      if (inFlightRef.current.has(flightKey)) {
        return { conflict: false, task: null };
      }
      inFlightRef.current.add(flightKey);
      track(setCancelPendingTaskIds, taskId, true);
      try {
        return await cancelDeploymentTask({ kubeconfig, namespace, taskId });
      } finally {
        inFlightRef.current.delete(flightKey);
        track(setCancelPendingTaskIds, taskId, false);
      }
    },
    [kubeconfig, namespace, track]
  );

  const redeploy = useCallback(
    async (predecessorTaskId: string) => {
      const flightKey = `redeploy:${predecessorTaskId}`;
      if (inFlightRef.current.has(flightKey)) {
        return { conflict: false, task: null };
      }
      inFlightRef.current.add(flightKey);
      track(setRedeployPendingTaskIds, predecessorTaskId, true);
      try {
        return await redeployDeploymentTask({
          appToken,
          kubeconfig,
          namespace,
          predecessorTaskId,
        });
      } finally {
        inFlightRef.current.delete(flightKey);
        track(setRedeployPendingTaskIds, predecessorTaskId, false);
      }
    },
    [appToken, kubeconfig, namespace, track]
  );

  return { cancel, cancelPendingTaskIds, redeploy, redeployPendingTaskIds };
}
