"use client";

import {
  createElement,
  Fragment,
  type ReactNode,
  useLayoutEffect,
  useMemo,
} from "react";
import type { CanvasLayoutResourceRef } from "@/features/project-canvas/layout/types";
import { useStableCallback } from "@/features/project-canvas/use-stable-callback";
import {
  type CanvasLifecycleActivityStore,
  createCanvasLifecycleActivityStore,
} from "@/features/project-canvas/workbench/lifecycle-activity-store";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";
import {
  type ProjectResourceActions,
  useProjectResourceActions,
} from "./resource-actions";
import { useResourceDeleteDialogs } from "./use-resource-delete-dialogs";
import { useResourceLifecycleDialogs } from "./use-resource-lifecycle-dialogs";

/**
 * Every Resource Action a node view can invoke. Lifecycle actions that destroy
 * or interrupt a workload are requests: they raise a confirmation first, and
 * only the confirmed request executes.
 */
export interface ProjectCanvasResourceActionCommands {
  clearDbPublicAccessPendingTarget: ProjectResourceActions["dbLifecycle"]["clearPublicAccessPendingTarget"];
  copyDatabaseConnection: ProjectResourceActions["copyDatabaseConnection"];
  requestApDelete: ReturnType<
    typeof useResourceDeleteDialogs
  >["requestApDelete"];
  requestApRestart: ReturnType<
    typeof useResourceLifecycleDialogs
  >["requestApRestart"];
  requestApStop: ReturnType<
    typeof useResourceLifecycleDialogs
  >["requestApStop"];
  requestDbDelete: ReturnType<
    typeof useResourceDeleteDialogs
  >["requestDbDelete"];
  requestDbRestart: ReturnType<
    typeof useResourceLifecycleDialogs
  >["requestDbRestart"];
  requestDbStop: ReturnType<
    typeof useResourceLifecycleDialogs
  >["requestDbStop"];
  resolveDatabaseConnectionString: ProjectResourceActions["resolveDatabaseConnectionString"];
  runResourceAction: ProjectResourceActions["runResourceAction"];
  startApWorkload: ProjectResourceActions["apLifecycle"]["startWorkload"];
  startDbWorkload: ProjectResourceActions["dbLifecycle"]["startWorkload"];
  toggleDatabasePublicAccess: ProjectResourceActions["toggleDatabasePublicAccess"];
}

export interface ProjectCanvasResourceActionsModel {
  commands: ProjectCanvasResourceActionCommands;
  /** Confirmation dialogs the host renders; each is keyed and self-contained. */
  dialogs: ReactNode[];
  /** What node views read to render per-resource action availability. */
  lifecycleActivityStore: CanvasLifecycleActivityStore;
}

/**
 * Resource Action execution, end to end: availability inputs in, then
 * confirmation, execution, lifecycle activity publication, and the workload
 * list refresh that follows a mutation. Resource Surface Intents are not part
 * of this module — an Affordance fronts either a Resource Action or a Surface
 * Intent, and merging them would create a second orchestration center.
 */
export function useProjectCanvasResourceActions({
  kubeconfig,
  onResourceLayoutDelete,
  refreshWorkloadLists,
}: {
  kubeconfig: string;
  /** Drops the deleted resource's Canvas Layout entries once the API confirms. */
  onResourceLayoutDelete?: (refs: readonly CanvasLayoutResourceRef[]) => void;
  refreshWorkloadLists?: () => Promise<unknown>;
}): ProjectCanvasResourceActionsModel {
  const routingDomain = useMemo(
    () => routingDomainFromKubeconfig(kubeconfig),
    [kubeconfig]
  );
  const resourceActions = useProjectResourceActions({
    kubeconfig,
    readOnly: false,
    refreshWorkloadLists,
    routingDomain,
  });

  const { requestApDelete, requestDbDelete, resourceDeleteDialog } =
    useResourceDeleteDialogs({
      deleteApWorkload: resourceActions.apLifecycle.deleteWorkload,
      deleteDbWorkload: resourceActions.dbLifecycle.deleteWorkload,
      onResourceLayoutDelete,
      runResourceAction: resourceActions.runResourceAction,
    });
  const {
    requestApRestart,
    requestApStop,
    requestDbRestart,
    requestDbStop,
    resourceLifecycleDialogs,
  } = useResourceLifecycleDialogs({
    restartApWorkload: resourceActions.apLifecycle.restartWorkload,
    restartDbWorkload: resourceActions.dbLifecycle.restartWorkload,
    runResourceAction: resourceActions.runResourceAction,
    stopApWorkload: resourceActions.apLifecycle.pauseWorkload,
    stopDbWorkload: resourceActions.dbLifecycle.stopWorkload,
  });

  const lifecycleActivityStore = useMemo(
    () => createCanvasLifecycleActivityStore(),
    []
  );
  const apAuthReady = resourceActions.apLifecycle.authReady;
  const dbAuthReady = resourceActions.dbLifecycle.authReady;
  const getDbPublicAccessPendingTarget =
    resourceActions.dbLifecycle.getPublicAccessPendingTarget;
  const isDbLifecycleLoading = resourceActions.dbLifecycle.isLoading;
  useLayoutEffect(() => {
    lifecycleActivityStore.publish({
      apAuthReady,
      dbAuthReady,
      getDbPublicAccessPendingTarget,
      isDbLifecycleLoading,
    });
  }, [
    apAuthReady,
    dbAuthReady,
    getDbPublicAccessPendingTarget,
    isDbLifecycleLoading,
    lifecycleActivityStore,
  ]);

  // Node views hold these across renders, so each stays referentially stable.
  const runResourceAction = useStableCallback(
    resourceActions.runResourceAction
  );
  const toggleDatabasePublicAccess = useStableCallback(
    resourceActions.toggleDatabasePublicAccess
  );
  const copyDatabaseConnection = useStableCallback(
    resourceActions.copyDatabaseConnection
  );
  const resolveDatabaseConnectionString = useStableCallback(
    resourceActions.resolveDatabaseConnectionString
  );
  const startApWorkload = useStableCallback(
    resourceActions.apLifecycle.startWorkload
  );
  const startDbWorkload = useStableCallback(
    resourceActions.dbLifecycle.startWorkload
  );
  const clearDbPublicAccessPendingTarget = useStableCallback(
    resourceActions.dbLifecycle.clearPublicAccessPendingTarget
  );

  const commands = useMemo<ProjectCanvasResourceActionCommands>(
    () => ({
      clearDbPublicAccessPendingTarget,
      copyDatabaseConnection,
      requestApDelete,
      requestApRestart,
      requestApStop,
      requestDbDelete,
      requestDbRestart,
      requestDbStop,
      resolveDatabaseConnectionString,
      runResourceAction,
      startApWorkload,
      startDbWorkload,
      toggleDatabasePublicAccess,
    }),
    [
      clearDbPublicAccessPendingTarget,
      copyDatabaseConnection,
      requestApDelete,
      requestApRestart,
      requestApStop,
      requestDbDelete,
      requestDbRestart,
      requestDbStop,
      resolveDatabaseConnectionString,
      runResourceAction,
      startApWorkload,
      startDbWorkload,
      toggleDatabasePublicAccess,
    ]
  );

  const dialogs = useMemo(
    () => [
      createElement(Fragment, { key: "resource-delete" }, resourceDeleteDialog),
      createElement(
        Fragment,
        { key: "resource-lifecycle" },
        resourceLifecycleDialogs
      ),
    ],
    [resourceDeleteDialog, resourceLifecycleDialogs]
  );

  return { commands, dialogs, lifecycleActivityStore };
}
