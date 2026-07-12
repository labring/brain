"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

import type { ApFact, DbFact, PublicAccessFact } from "./resource-facts";
import {
  type ProjectRuntimeNodeModel,
  projectRuntimeFallbackNodeModelFromLookup,
  projectRuntimeNodeModelFromFact,
  projectRuntimeShellLookupFromNodeData,
} from "./resource-models";
import type {
  ProjectRuntimeShellLookup,
  ProjectRuntimeStore,
} from "./resource-store";

type RuntimeFact = ApFact | DbFact | PublicAccessFact;

export interface ProjectRuntimeNodeModelSource {
  data: unknown;
  id: string;
  type?: string;
}

const ProjectRuntimeStoreContext = createContext<ProjectRuntimeStore | null>(
  null
);

export function ProjectRuntimeStoreProvider({
  children,
  store,
}: {
  children: ReactNode;
  store: ProjectRuntimeStore;
}) {
  return (
    <ProjectRuntimeStoreContext.Provider value={store}>
      {children}
    </ProjectRuntimeStoreContext.Provider>
  );
}

function emptySubscribe() {
  return () => undefined;
}

function selectRuntimeFact(
  store: ProjectRuntimeStore | null,
  lookup: ProjectRuntimeShellLookup | undefined
): RuntimeFact | undefined {
  if (store === null || lookup === undefined) {
    return undefined;
  }
  switch (lookup.kind) {
    case "AP":
      return store.selectApFact(lookup.modelKey);
    case "DB":
      return store.selectDbFact(lookup.modelKey);
    case "PublicAccess":
      return store.selectPublicAccessFact(lookup.modelKey);
    default:
      return undefined;
  }
}

function subscribeRuntimeFact(
  store: ProjectRuntimeStore | null,
  lookup: ProjectRuntimeShellLookup | undefined,
  onStoreChange: () => void
): () => void {
  if (store === null || lookup === undefined) {
    return emptySubscribe();
  }
  switch (lookup.kind) {
    case "AP":
      return store.subscribeApFact(lookup.modelKey, onStoreChange);
    case "DB":
      return store.subscribeDbFact(lookup.modelKey, onStoreChange);
    case "PublicAccess":
      return store.subscribePublicAccessFact(lookup.modelKey, onStoreChange);
    default:
      return emptySubscribe();
  }
}

export function useProjectRuntimeNodeModel<
  TModel extends ProjectRuntimeNodeModel,
>(source: ProjectRuntimeNodeModelSource): TModel | undefined {
  const store = useContext(ProjectRuntimeStoreContext);
  const lookup = useMemo(
    () => projectRuntimeShellLookupFromNodeData(source.data),
    [source.data]
  );
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeRuntimeFact(store, lookup, onStoreChange),
    [store, lookup]
  );
  const fact = useSyncExternalStore(
    subscribe,
    () => selectRuntimeFact(store, lookup),
    () => undefined
  );
  return useMemo(() => {
    if (lookup === undefined) {
      return undefined;
    }
    if (fact === undefined) {
      return projectRuntimeFallbackNodeModelFromLookup(lookup) as
        | TModel
        | undefined;
    }
    return projectRuntimeNodeModelFromFact(lookup.kind, fact) as
      | TModel
      | undefined;
  }, [fact, lookup]);
}
