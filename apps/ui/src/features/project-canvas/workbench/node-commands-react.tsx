"use client";

import type { DatabaseNodeCopyConnectionHandler } from "@workspace/ui/components/database-node/database-node";
import type { Node } from "@xyflow/react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import type { ProjectCanvasCommandPlan } from "@/features/project-canvas/workbench/command-model";
import {
  type CanvasApLifecycleActivity,
  type CanvasDbLifecycleActivity,
  type CanvasLifecycleActivityStore,
  createCanvasLifecycleActivityStore,
} from "@/features/project-canvas/workbench/lifecycle-activity-store";
import type {
  ProjectCanvasApDeleteTarget,
  ProjectCanvasDbDeleteTarget,
} from "@/features/project-canvas/workbench/project-canvas-delete-dialog";
import type {
  ProjectCanvasApLifecycleTarget,
  ProjectCanvasDbLifecycleTarget,
} from "@/features/project-canvas/workbench/project-canvas-lifecycle-dialog";
import type { ProjectResourceActions } from "@/features/project-resource-actions/resource-actions";

interface WorkloadRef {
  name: string;
  namespace: string;
}

/**
 * Referentially permanent command surface handed to canvas node views.
 * Every function identity is stable for the lifetime of the canvas, so
 * consuming it never invalidates node memoization; per-node reactive state
 * (loading, auth readiness) flows through the lifecycle activity store
 * instead.
 */
export interface ProjectCanvasNodeCommands {
  clearDbPublicAccessPendingTarget: (ref: WorkloadRef) => void;
  copyDatabaseConnection: DatabaseNodeCopyConnectionHandler;
  executeCommandPlan: (plan: ProjectCanvasCommandPlan) => void;
  getNodes: () => readonly Node[];
  /** Persists node presentation state (expansion) via the layout scheduler. */
  persistNodeLayout: (node: Node) => void;
  projectId?: string;
  readOnly: boolean;
  requestApDelete: (target: ProjectCanvasApDeleteTarget) => void;
  requestApRestart: (target: ProjectCanvasApLifecycleTarget) => void;
  requestApStop: (target: ProjectCanvasApLifecycleTarget) => void;
  requestDbDelete: (target: ProjectCanvasDbDeleteTarget) => void;
  requestDbRestart: (target: ProjectCanvasDbLifecycleTarget) => void;
  requestDbStop: (target: ProjectCanvasDbLifecycleTarget) => void;
  runResourceAction: ProjectResourceActions["runResourceAction"];
  startApWorkload: (ref: WorkloadRef) => Promise<unknown>;
  startDbWorkload: (ref: WorkloadRef) => Promise<unknown>;
  toggleDatabasePublicAccess: ProjectResourceActions["toggleDatabasePublicAccess"];
}

const ProjectCanvasNodeCommandsContext =
  createContext<ProjectCanvasNodeCommands | null>(null);

const CanvasLifecycleActivityContext =
  createContext<CanvasLifecycleActivityStore | null>(null);

const EMPTY_ACTIVITY_STORE = createCanvasLifecycleActivityStore();

export function ProjectCanvasNodeCommandsProvider({
  children,
  commands,
  lifecycleActivity,
}: {
  children: ReactNode;
  commands: ProjectCanvasNodeCommands | null;
  lifecycleActivity: CanvasLifecycleActivityStore | null;
}) {
  return (
    <ProjectCanvasNodeCommandsContext value={commands}>
      <CanvasLifecycleActivityContext
        value={lifecycleActivity ?? EMPTY_ACTIVITY_STORE}
      >
        {children}
      </CanvasLifecycleActivityContext>
    </ProjectCanvasNodeCommandsContext>
  );
}

/**
 * Node-view access to the canvas command surface. Null outside a project
 * canvas (e.g. component previews), where node views render without
 * resource actions.
 */
export function useProjectCanvasNodeCommands(): ProjectCanvasNodeCommands | null {
  return useContext(ProjectCanvasNodeCommandsContext);
}

export function useCanvasApLifecycleActivity(): CanvasApLifecycleActivity {
  const store =
    useContext(CanvasLifecycleActivityContext) ?? EMPTY_ACTIVITY_STORE;
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeAp(listener),
    [store]
  );
  const getSnapshot = useCallback(() => store.getApActivity(), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const INACTIVE_DB_ACTIVITY: CanvasDbLifecycleActivity = {
  authReady: false,
  loadingDelete: false,
  loadingRestart: false,
  loadingStart: false,
  loadingStop: false,
  publicAccessPendingTarget: undefined,
};

export function useCanvasDbLifecycleActivity(
  ref: WorkloadRef | null
): CanvasDbLifecycleActivity {
  const store =
    useContext(CanvasLifecycleActivityContext) ?? EMPTY_ACTIVITY_STORE;
  const name = ref?.name ?? "";
  const namespace = ref?.namespace ?? "";
  const active = ref != null;

  const subscribe = useCallback(
    (listener: () => void) => {
      if (!active) {
        return () => undefined;
      }
      return store.subscribeDb({ name, namespace }, listener);
    },
    [active, name, namespace, store]
  );
  const getSnapshot = useCallback(() => {
    if (!active) {
      return INACTIVE_DB_ACTIVITY;
    }
    return store.getDbActivity({ name, namespace });
  }, [active, name, namespace, store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
