"use client";

import type { Node } from "@xyflow/react";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

import type {
  CanvasContainerNodeData,
  CanvasDatabaseNodeData,
} from "@/features/project-canvas/nodes/types";
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

export interface ProjectRuntimeNodeModelDecorators {
  decorateContainerModel?: (args: {
    model: CanvasContainerNodeData;
    node: Node;
  }) => CanvasContainerNodeData;
  decorateDatabaseModel?: (args: {
    model: CanvasDatabaseNodeData;
    node: Node;
  }) => CanvasDatabaseNodeData;
}

const ProjectRuntimeStoreContext = createContext<ProjectRuntimeStore | null>(
  null
);
const ProjectRuntimeNodeModelDecoratorsContext =
  createContext<ProjectRuntimeNodeModelDecorators | null>(null);

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

export function ProjectRuntimeNodeModelDecoratorsProvider({
  children,
  decorators,
}: {
  children: ReactNode;
  decorators?: ProjectRuntimeNodeModelDecorators;
}) {
  return (
    <ProjectRuntimeNodeModelDecoratorsContext.Provider
      value={decorators ?? null}
    >
      {children}
    </ProjectRuntimeNodeModelDecoratorsContext.Provider>
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

function decoratorNodeFromSource(
  source: ProjectRuntimeNodeModelSource,
  model: ProjectRuntimeNodeModel
): Node {
  return {
    data: model,
    id: source.id,
    position: { x: 0, y: 0 },
    type: source.type,
  } as Node;
}

function decorateRuntimeNodeModel({
  decorators,
  lookup,
  model,
  source,
}: {
  decorators: ProjectRuntimeNodeModelDecorators | null;
  lookup: ProjectRuntimeShellLookup | undefined;
  model: ProjectRuntimeNodeModel | undefined;
  source: ProjectRuntimeNodeModelSource;
}): ProjectRuntimeNodeModel | undefined {
  if (model === undefined || lookup === undefined || decorators === null) {
    return model;
  }
  const node = decoratorNodeFromSource(source, model);
  switch (lookup.kind) {
    case "AP":
      return (
        decorators.decorateContainerModel?.({
          model: model as CanvasContainerNodeData,
          node,
        }) ?? model
      );
    case "DB":
      return (
        decorators.decorateDatabaseModel?.({
          model: model as CanvasDatabaseNodeData,
          node,
        }) ?? model
      );
    case "PublicAccess":
      return model;
    default:
      return model;
  }
}

export function useProjectRuntimeNodeModel<
  TModel extends ProjectRuntimeNodeModel,
>(source: ProjectRuntimeNodeModelSource): TModel | undefined {
  const store = useContext(ProjectRuntimeStoreContext);
  const decorators = useContext(ProjectRuntimeNodeModelDecoratorsContext);
  const lookup = useMemo(
    () => projectRuntimeShellLookupFromNodeData(source.data),
    [source.data]
  );
  const fact = useSyncExternalStore(
    (onStoreChange) => subscribeRuntimeFact(store, lookup, onStoreChange),
    () => selectRuntimeFact(store, lookup),
    () => undefined
  );
  const baseModel = useMemo(() => {
    if (lookup === undefined) {
      return undefined;
    }
    if (fact === undefined) {
      return projectRuntimeFallbackNodeModelFromLookup(lookup);
    }
    return projectRuntimeNodeModelFromFact(lookup.kind, fact);
  }, [fact, lookup]);

  return useMemo(
    () =>
      decorateRuntimeNodeModel({
        decorators,
        lookup,
        model: baseModel,
        source,
      }) as TModel | undefined,
    [baseModel, decorators, lookup, source]
  );
}
