import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import type { ProjectCanvasSelection } from "@/features/panes/canvas-selection";
import type { ProjectSideSurfaceEntry } from "@/features/panes/surface-state";

type DeploymentTaskTimelineEntry = Extract<
  ProjectSideSurfaceEntry,
  { kind: "deploymentTaskTimeline" }
>;

/**
 * The workbench's orchestration core: decision logic as pure transitions,
 * `(state, event) → (nextState, effects)`. The React hook is the effect
 * boundary — it reads route snapshots and resource facts,
 * submits events, and executes the returned effect plans. Session-local
 * orchestration state lives only here and changes only by committing
 * transition results.
 */
export interface WorkbenchOrchestrationState {
  /** Last committed covered state, so a covered→uncovered edge is detectable. */
  canvasCovered: boolean;
  dismissedDeploymentTaskUpdatedAtById: ReadonlyMap<string, string>;
  localCanvasStackOrderByRef: ReadonlyMap<string, number>;
  manuallyClosedDeploymentTaskTimelineTaskIds: ReadonlySet<string>;
  sideViewportFocusRequestSeq: number;
}

export type WorkbenchOrchestrationEvent =
  | { covered: boolean; kind: "canvasCoveredChanged" }
  | {
      kind: "canvasNodeBroughtToFront";
      node: Node;
      persist: boolean;
      stackKey: string | undefined;
      stackOrder: number | undefined;
    }
  | {
      activeTimelineTaskId: string | null;
      kind: "deploymentTaskDismissRequested";
      task: DeploymentTaskProjection;
    }
  | {
      dismissedTaskUpdatedAtById: ReadonlyMap<string, string>;
      kind: "deploymentTaskDockDismissalsReloaded";
    }
  | { kind: "deploymentTaskTimelineManuallyClosed"; taskId: string }
  | {
      canvasSelection?: ProjectCanvasSelection | null;
      entry: DeploymentTaskTimelineEntry;
      kind: "deploymentTaskTimelineOpenRequested";
    }
  | { kind: "deploymentTaskTimelineRouteCommitted" }
  | {
      detail: { projectId?: string; taskId: string };
      kind: "deployTaskCreatedEventReceived";
      workbenchProjectId: string;
    }
  | {
      dismissedTaskUpdatedAtById: ReadonlyMap<string, string>;
      kind: "workbenchIdentityChanged";
    };

export type WorkbenchOrchestrationEffect =
  | { kind: "acknowledgeDeployTaskCreated"; taskId: string }
  | { kind: "closeSideSurface" }
  | {
      canvasSelection?: ProjectCanvasSelection | null;
      entry: DeploymentTaskTimelineEntry;
      kind: "openDeploymentTaskTimelineRoute";
    }
  | { kind: "persistCanvasNodeLayout"; node: Node }
  | {
      dismissedTaskUpdatedAtById: ReadonlyMap<string, string>;
      kind: "persistDeploymentTaskDockDismissals";
    }
  | { kind: "revalidateResourceSnapshot" };

export interface WorkbenchOrchestrationTransition {
  effects: readonly WorkbenchOrchestrationEffect[];
  state: WorkbenchOrchestrationState;
}

function openTimelineTransition(
  state: WorkbenchOrchestrationState,
  entry: DeploymentTaskTimelineEntry,
  canvasSelection: ProjectCanvasSelection | null | undefined
): WorkbenchOrchestrationTransition {
  let next = state;
  if (state.manuallyClosedDeploymentTaskTimelineTaskIds.has(entry.taskId)) {
    const manuallyClosed = new Set(
      state.manuallyClosedDeploymentTaskTimelineTaskIds
    );
    manuallyClosed.delete(entry.taskId);
    next = {
      ...state,
      manuallyClosedDeploymentTaskTimelineTaskIds: manuallyClosed,
    };
  }
  return {
    effects: [
      { canvasSelection, entry, kind: "openDeploymentTaskTimelineRoute" },
    ],
    state: next,
  };
}

function canvasCoveredChanged(
  state: WorkbenchOrchestrationState,
  event: Extract<WorkbenchOrchestrationEvent, { kind: "canvasCoveredChanged" }>
): WorkbenchOrchestrationTransition {
  if (state.canvasCovered === event.covered) {
    return { effects: [], state };
  }
  return {
    effects:
      state.canvasCovered && !event.covered
        ? [{ kind: "revalidateResourceSnapshot" }]
        : [],
    state: { ...state, canvasCovered: event.covered },
  };
}

function canvasNodeBroughtToFront(
  state: WorkbenchOrchestrationState,
  event: Extract<
    WorkbenchOrchestrationEvent,
    { kind: "canvasNodeBroughtToFront" }
  >
): WorkbenchOrchestrationTransition {
  let next = state;
  if (
    event.stackKey !== undefined &&
    event.stackOrder !== undefined &&
    state.localCanvasStackOrderByRef.get(event.stackKey) !== event.stackOrder
  ) {
    const stackOrderByRef = new Map(state.localCanvasStackOrderByRef);
    stackOrderByRef.set(event.stackKey, event.stackOrder);
    next = { ...state, localCanvasStackOrderByRef: stackOrderByRef };
  }
  return {
    effects: event.persist
      ? [{ kind: "persistCanvasNodeLayout", node: event.node }]
      : [],
    state: next,
  };
}

function deploymentTaskDismissRequested(
  state: WorkbenchOrchestrationState,
  event: Extract<
    WorkbenchOrchestrationEvent,
    { kind: "deploymentTaskDismissRequested" }
  >
): WorkbenchOrchestrationTransition {
  let next = state;
  const effects: WorkbenchOrchestrationEffect[] = [];
  if (
    state.dismissedDeploymentTaskUpdatedAtById.get(event.task.id) !==
    event.task.updatedAt
  ) {
    const dismissed = new Map(state.dismissedDeploymentTaskUpdatedAtById);
    dismissed.set(event.task.id, event.task.updatedAt);
    next = { ...next, dismissedDeploymentTaskUpdatedAtById: dismissed };
    effects.push({
      dismissedTaskUpdatedAtById: dismissed,
      kind: "persistDeploymentTaskDockDismissals",
    });
  }
  // The active chip is the open timeline pane's handle, so the dismissal
  // alone cannot remove it; close the pane so the dismissal takes visible
  // effect (CONTEXT.md: Deployment Task Dock Dismissal).
  if (event.task.id === event.activeTimelineTaskId) {
    effects.push({ kind: "closeSideSurface" });
  }
  return { effects, state: next };
}

function deploymentTaskTimelineManuallyClosed(
  state: WorkbenchOrchestrationState,
  taskId: string
): WorkbenchOrchestrationTransition {
  if (state.manuallyClosedDeploymentTaskTimelineTaskIds.has(taskId)) {
    return { effects: [], state };
  }
  return {
    effects: [],
    state: {
      ...state,
      manuallyClosedDeploymentTaskTimelineTaskIds: new Set(
        state.manuallyClosedDeploymentTaskTimelineTaskIds
      ).add(taskId),
    },
  };
}

function deployTaskCreatedEventReceived(
  state: WorkbenchOrchestrationState,
  event: Extract<
    WorkbenchOrchestrationEvent,
    { kind: "deployTaskCreatedEventReceived" }
  >
): WorkbenchOrchestrationTransition {
  const currentProjectId = event.workbenchProjectId.trim();
  const detailProjectId = event.detail.projectId?.trim();
  if (
    currentProjectId === "" ||
    event.detail.taskId.trim() === "" ||
    detailProjectId !== currentProjectId
  ) {
    return { effects: [], state };
  }
  if (
    state.manuallyClosedDeploymentTaskTimelineTaskIds.has(event.detail.taskId)
  ) {
    return {
      effects: [
        { kind: "acknowledgeDeployTaskCreated", taskId: event.detail.taskId },
      ],
      state,
    };
  }
  const opened = openTimelineTransition(
    state,
    {
      kind: "deploymentTaskTimeline",
      projectId: currentProjectId,
      taskId: event.detail.taskId,
    },
    undefined
  );
  return {
    effects: [
      ...opened.effects,
      { kind: "acknowledgeDeployTaskCreated", taskId: event.detail.taskId },
    ],
    state: opened.state,
  };
}

function workbenchIdentityChanged(
  state: WorkbenchOrchestrationState,
  dismissedTaskUpdatedAtById: ReadonlyMap<string, string>
): WorkbenchOrchestrationTransition {
  return {
    effects: [],
    state: {
      ...state,
      canvasCovered: false,
      dismissedDeploymentTaskUpdatedAtById: dismissedTaskUpdatedAtById,
      localCanvasStackOrderByRef: new Map(),
      manuallyClosedDeploymentTaskTimelineTaskIds: new Set(),
      sideViewportFocusRequestSeq: 0,
    },
  };
}

export function transitionWorkbenchOrchestration(
  state: WorkbenchOrchestrationState,
  event: WorkbenchOrchestrationEvent
): WorkbenchOrchestrationTransition {
  switch (event.kind) {
    case "canvasCoveredChanged": {
      return canvasCoveredChanged(state, event);
    }
    case "canvasNodeBroughtToFront": {
      return canvasNodeBroughtToFront(state, event);
    }
    case "deploymentTaskDismissRequested": {
      return deploymentTaskDismissRequested(state, event);
    }
    case "deploymentTaskDockDismissalsReloaded": {
      return {
        effects: [],
        state: {
          ...state,
          dismissedDeploymentTaskUpdatedAtById:
            event.dismissedTaskUpdatedAtById,
        },
      };
    }
    case "deploymentTaskTimelineManuallyClosed": {
      return deploymentTaskTimelineManuallyClosed(state, event.taskId);
    }
    case "deploymentTaskTimelineOpenRequested": {
      return openTimelineTransition(state, event.entry, event.canvasSelection);
    }
    case "deploymentTaskTimelineRouteCommitted": {
      return {
        effects: [],
        state: {
          ...state,
          sideViewportFocusRequestSeq: state.sideViewportFocusRequestSeq + 1,
        },
      };
    }
    case "deployTaskCreatedEventReceived": {
      return deployTaskCreatedEventReceived(state, event);
    }
    case "workbenchIdentityChanged": {
      return workbenchIdentityChanged(state, event.dismissedTaskUpdatedAtById);
    }
    default: {
      event satisfies never;
      return { effects: [], state };
    }
  }
}

export interface WorkbenchOrchestrationStore {
  /** Runs the transition, commits the state, and returns the effect plan. */
  dispatch(
    event: WorkbenchOrchestrationEvent
  ): readonly WorkbenchOrchestrationEffect[];
  getSnapshot(): WorkbenchOrchestrationState;
  subscribe(listener: () => void): () => void;
}

export function createWorkbenchOrchestrationStore(initial?: {
  dismissedTaskUpdatedAtById?: ReadonlyMap<string, string>;
}): WorkbenchOrchestrationStore {
  let state: WorkbenchOrchestrationState = {
    canvasCovered: false,
    dismissedDeploymentTaskUpdatedAtById:
      initial?.dismissedTaskUpdatedAtById ?? new Map(),
    localCanvasStackOrderByRef: new Map(),
    manuallyClosedDeploymentTaskTimelineTaskIds: new Set(),
    sideViewportFocusRequestSeq: 0,
  };
  const listeners = new Set<() => void>();

  return {
    dispatch(event) {
      const result = transitionWorkbenchOrchestration(state, event);
      if (result.state !== state) {
        state = result.state;
        for (const listener of listeners) {
          listener();
        }
      }
      return result.effects;
    },
    getSnapshot() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
