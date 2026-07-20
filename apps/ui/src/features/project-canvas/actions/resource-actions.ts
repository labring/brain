"use client";

import {
  type ApLifecycleWorkloadRef,
  type DbLifecycleWorkloadRef,
  useApLifecycleOperations,
  useDbConnectionStringResolver,
  useDbLifecycleOperations,
} from "@workspace/api/hooks";
import type { DatabaseNodeConnection } from "@workspace/ui/components/database-node/database-node";
import { useCallback } from "react";
import type {
  ProjectApTarget,
  ProjectDbTarget,
} from "@/features/panes/target-identity";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import { copyDbConnectionValue } from "@/lib/secret-reveal";
import { errorDescription, toastPromiseDetail } from "@/lib/toast-utils";

export interface ProjectResourceActionCopy {
  loading: string;
  success: string;
}

export type ProjectDbConnectionCopyHandler = (
  connection: DatabaseNodeConnection,
  workload: DbLifecycleWorkloadRef | null
) => Promise<void>;

export type ProjectDbConnectionResolveHandler = (
  connection: DatabaseNodeConnection,
  workload: DbLifecycleWorkloadRef | null
) => Promise<string>;

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
      toastPromiseDetail(
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
          errorDescription: (err) => errorDescription(err, "Operation failed."),
          errorTitle: "Operation failed.",
          loading: copy.loading,
          success: copy.success,
        }
      );
    },
    [refreshAfterResourceAction]
  );

  const { authReady: revealReady, resolveConnectionString } =
    useDbConnectionStringResolver({
      kubeconfig: readOnly ? undefined : kubeconfig,
    });

  const copyDatabaseConnection = useCallback<ProjectDbConnectionCopyHandler>(
    (connection, workload) =>
      // Connection rows carry credential-free DB Connection Templates; copy
      // fetches the complete DB Connection DSN on demand (ADR-0052). The
      // template is copied only when no resolver backs the canvas at all.
      copyDbConnectionValue({
        placeholderValue: connection.value ?? "",
        resolveAvailable: workload != null && revealReady,
        resolveValue: () =>
          workload == null
            ? Promise.reject(new Error("DB workload is unavailable."))
            : resolveConnectionString(workload, connection.kind),
      }),
    [resolveConnectionString, revealReady]
  );

  // Backs the connection-row eye (ADR-0054): fetches the complete DB
  // Connection DSN on demand so revealed values never persist in page state.
  const resolveDatabaseConnectionString =
    useCallback<ProjectDbConnectionResolveHandler>(
      (connection, workload) =>
        workload == null || !revealReady
          ? Promise.reject(
              new Error("Connection string reveal is unavailable.")
            )
          : resolveConnectionString(workload, connection.kind),
      [resolveConnectionString, revealReady]
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
    resolveDatabaseConnectionString,
    runResourceAction,
    toggleDatabasePublicAccess,
  };
}

export type ProjectResourceActions = ReturnType<
  typeof useProjectResourceActions
>;
