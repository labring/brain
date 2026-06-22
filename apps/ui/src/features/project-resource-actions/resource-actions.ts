"use client";

import {
  type ApLifecycleWorkloadRef,
  type DbLifecycleWorkloadRef,
  useApLifecycleOperations,
  useDbLifecycleOperations,
} from "@workspace/api/hooks";
import type { DatabaseNodeCopyConnectionHandler } from "@workspace/ui/components/database-node/database-node";
import { useCallback } from "react";
import { toast } from "sonner";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import type {
  ProjectApTarget,
  ProjectDbTarget,
} from "@/features/project-surfaces/target-identity";

export interface ProjectResourceActionCopy {
  loading: string;
  success: string;
}

export interface RunProjectResourceActionOptions {
  onSettled?: () => void;
  onSuccess?: () => void;
}

function cleanTargetPart(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function apLifecycleWorkloadRefFromTarget(
  target: ProjectApTarget | null | undefined
): ApLifecycleWorkloadRef | null {
  if (target == null) {
    return null;
  }
  const name = cleanTargetPart(target.name);
  const namespace = cleanTargetPart(target.namespace);
  return name == null || namespace == null ? null : { name, namespace };
}

export function dbLifecycleWorkloadRefFromTarget(
  target: ProjectDbTarget | null | undefined
): DbLifecycleWorkloadRef | null {
  if (target == null) {
    return null;
  }
  const name = cleanTargetPart(target.name);
  const namespace = cleanTargetPart(target.namespace);
  return name == null || namespace == null ? null : { name, namespace };
}

export function resourceLayoutRefsForApDelete(target: ApLifecycleWorkloadRef) {
  return [
    {
      kind: "AP" as const,
      name: target.name,
      namespace: target.namespace,
    },
    {
      kind: "PublicAccess" as const,
      name: target.name,
      namespace: target.namespace,
    },
  ];
}

export function resourceLayoutRefsForDbDelete(target: DbLifecycleWorkloadRef) {
  return [
    {
      kind: "DB" as const,
      name: target.name,
      namespace: target.namespace,
    },
  ];
}

export function useProjectResourceActions({
  kubeconfig,
  readOnly,
  refreshWorkloadLists,
  routingDomain,
}: {
  kubeconfig?: string;
  readOnly: boolean;
  refreshWorkloadLists?: () => Promise<unknown>;
  routingDomain: string;
}) {
  const apLifecycle = useApLifecycleOperations({
    kubeconfig: readOnly ? undefined : kubeconfig,
  });
  const dbLifecycle = useDbLifecycleOperations({
    kubeconfig: readOnly ? undefined : kubeconfig,
  });

  const refreshAfterResourceAction = useCallback(async () => {
    try {
      await refreshWorkloadLists?.();
    } catch {
      // ignore refresh failures; list will reconcile on next poll
    }
  }, [refreshWorkloadLists]);

  const runResourceAction = useCallback(
    (
      mutation: () => Promise<unknown>,
      copy: ProjectResourceActionCopy,
      options?: RunProjectResourceActionOptions
    ) => {
      toast.promise(
        (async (): Promise<void> => {
          try {
            await mutation();
            options?.onSuccess?.();
            await refreshAfterResourceAction();
          } finally {
            options?.onSettled?.();
          }
        })(),
        {
          error: (err) =>
            err instanceof Error ? err.message : "Operation failed",
          loading: copy.loading,
          success: copy.success,
        }
      );
    },
    [refreshAfterResourceAction]
  );

  const copyDatabaseConnection = useCallback<DatabaseNodeCopyConnectionHandler>(
    async (connection) => {
      const value = connection.value;
      if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
        return;
      }

      try {
        await navigator.clipboard.writeText(value);
      } catch {
        // Copy feedback is handled by the row; clipboard failures should not break canvas interactions.
      }
    },
    []
  );

  const toggleDatabasePublicAccess = useCallback(
    ({
      metadata,
      nextEnabled,
      workload,
    }: {
      metadata: CanvasDatabaseNodeData["metadata"];
      nextEnabled: boolean;
      workload: DbLifecycleWorkloadRef;
    }) =>
      dbLifecycle.togglePublicAccess(workload, nextEnabled, {
        metadata,
        routingDomain,
      }),
    [dbLifecycle, routingDomain]
  );

  return {
    apLifecycle,
    copyDatabaseConnection,
    dbLifecycle,
    refreshAfterResourceAction,
    runResourceAction,
    toggleDatabasePublicAccess,
  };
}

export type ProjectResourceActions = ReturnType<
  typeof useProjectResourceActions
>;
