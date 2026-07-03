"use client";

import type { CanvasState } from "@workspace/ui/components/canvas/canvas.types";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  createProjectCanvasInteractionStore,
  type ProjectCanvasInteractionSnapshot,
  type ProjectCanvasInteractionStore,
} from "./interaction-store";

const ProjectCanvasInteractionStoreContext =
  createContext<ProjectCanvasInteractionStore | null>(null);

const EMPTY_STORE = createProjectCanvasInteractionStore();

export function interactionSnapshotFromCanvasState(
  state: Pick<CanvasState, "connectionOrigin" | "selectedEdge" | "selectedNode">
): ProjectCanvasInteractionSnapshot {
  return {
    connectionOrigin: state.connectionOrigin ?? null,
    selectedEdge:
      state.selectedEdge == null
        ? null
        : {
            source: state.selectedEdge.source,
            target: state.selectedEdge.target,
          },
    selectedNodeId: state.selectedNode?.id ?? null,
  };
}

export function ProjectCanvasInteractionProvider({
  children,
  state,
}: {
  children: ReactNode;
  state: Pick<
    CanvasState,
    "connectionOrigin" | "selectedEdge" | "selectedNode"
  >;
}) {
  const storeRef = useRef<ProjectCanvasInteractionStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createProjectCanvasInteractionStore(
      interactionSnapshotFromCanvasState(state)
    );
  }
  const store = storeRef.current;

  useLayoutEffect(() => {
    store.setSnapshot(interactionSnapshotFromCanvasState(state));
  }, [state, store]);

  return (
    <ProjectCanvasInteractionStoreContext value={store}>
      {children}
    </ProjectCanvasInteractionStoreContext>
  );
}

/**
 * Provides a controller-owned interaction store. Preferred over
 * ProjectCanvasInteractionProvider: the controller writes snapshots
 * imperatively, so selection changes never flow through view props.
 */
export function ProjectCanvasInteractionStoreProvider({
  children,
  store,
}: {
  children: ReactNode;
  store: ProjectCanvasInteractionStore | null;
}) {
  return (
    <ProjectCanvasInteractionStoreContext value={store ?? EMPTY_STORE}>
      {children}
    </ProjectCanvasInteractionStoreContext>
  );
}

export function useProjectCanvasNodeInteraction(nodeId: string) {
  const store = useContext(ProjectCanvasInteractionStoreContext) ?? EMPTY_STORE;
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeNode(nodeId, listener),
    [nodeId, store]
  );
  const getSnapshot = useCallback(
    () => store.getNodeInteraction(nodeId),
    [nodeId, store]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
