"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import {
  type CanvasGlassStore,
  createCanvasGlassStore,
} from "./canvas-glass-store";

const CanvasGlassStoreContext = createContext<CanvasGlassStore | null>(null);

/** Default store for subtrees without a sheet: every node keeps its own blur. */
const EMPTY_STORE = createCanvasGlassStore();

export function CanvasGlassStoreProvider({
  children,
  store,
}: {
  children: ReactNode;
  store: CanvasGlassStore | null;
}) {
  return (
    <CanvasGlassStoreContext value={store ?? EMPTY_STORE}>
      {children}
    </CanvasGlassStoreContext>
  );
}

/**
 * Whether this node should paint its own `backdrop-filter`. True (keep blur)
 * when there is no active sheet or when the node overlaps another node; false
 * when the shared sheet blurs under it. `null` nodeId (rendered outside a React
 * Flow node) keeps blur, preserving standalone/preview usage.
 */
export function useCanvasNodeSelfBlur(nodeId: string | null): boolean {
  const store = useContext(CanvasGlassStoreContext) ?? EMPTY_STORE;
  const subscribe = useCallback(
    (listener: () => void) =>
      nodeId == null ? () => undefined : store.subscribeNode(nodeId, listener),
    [nodeId, store]
  );
  const getSnapshot = useCallback(
    () => (nodeId == null ? true : store.getNodeSelfBlur(nodeId)),
    [nodeId, store]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
