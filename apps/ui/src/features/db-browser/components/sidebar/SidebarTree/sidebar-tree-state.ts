import { atom } from "jotai";
import { selectAtom } from "jotai/utils";
import type { TreeNodeData } from "./types";

export interface SidebarTreeState {
  expandedItems: ReadonlySet<string>;
  isLoading: Readonly<Record<string, boolean>>;
  isRestoring: boolean;
  treeData: Readonly<Record<string, TreeNodeData[]>>;
}

export function createSidebarTreeState(): SidebarTreeState {
  return {
    expandedItems: new Set(),
    isLoading: {},
    isRestoring: true,
    treeData: {},
  };
}

/** Atom values are isolated by DbAccessSessionProvider's per-session store. */
export const sidebarTreeStateAtom = atom<SidebarTreeState>(
  createSidebarTreeState()
);

export const sidebarTreeAnyLoadingAtom = selectAtom(
  sidebarTreeStateAtom,
  (state) => Object.values(state.isLoading).some(Boolean)
);

export function sidebarTreeNodeExpandedAtom(nodeId: string) {
  return selectAtom(sidebarTreeStateAtom, (state) =>
    state.expandedItems.has(nodeId)
  );
}

export function sidebarTreeNodeLoadingAtom(nodeId: string) {
  return selectAtom(
    sidebarTreeStateAtom,
    (state) => state.isLoading[nodeId] ?? false
  );
}

export function sidebarTreeNodeChildrenAtom(nodeId: string) {
  return selectAtom(sidebarTreeStateAtom, (state) => state.treeData[nodeId]);
}
