import type { Node } from "@xyflow/react";
import { databaseNodeDataFromNode } from "@/features/project-canvas/nodes/database-node-data";
import type { CanvasDatabaseNodeData } from "@/features/project-canvas/nodes/types";
import {
  type ProjectRuntimeNodeModel,
  type ProjectRuntimeNodeModels,
  projectRuntimeNodeModelFromFact,
  projectRuntimeShellLookupFromNodeData,
} from "@/features/project-runtime/resource-models";
import type {
  ProjectRuntimeShellLookup,
  ProjectRuntimeStore,
} from "@/features/project-runtime/resource-store";
import {
  type ProjectDrawerSurfaceEntry,
  type ProjectGlobalSidePaneEntry,
  type ProjectMainSurfaceEntry,
  type ProjectSideSurfaceEntry,
  type ProjectSurfaceState,
  projectSideSurfaceVisible,
} from "@/features/project-surfaces/surface-state";
import type {
  ProjectApTarget,
  ProjectDbTarget,
  ProjectSurfaceTarget,
} from "@/features/project-surfaces/target-identity";
import { findCanvasNodeForProjectTarget } from "./selection";

type ProjectCanvasTargetedSideEntry = Extract<
  ProjectSideSurfaceEntry,
  { target: ProjectSurfaceTarget }
>;
type ProjectCanvasPendingTargetEntry =
  | ProjectCanvasTargetedSideEntry
  | ProjectDrawerSurfaceEntry
  | ProjectMainSurfaceEntry;
interface ProjectRuntimeModelReader {
  runtimeNodeModels?: ProjectRuntimeNodeModels;
  runtimeStore?: ProjectRuntimeStore;
}
interface ProjectCanvasSurfaceRenderModelInput {
  nodes: readonly Node[];
  runtimeNodeModels?: ProjectRuntimeNodeModels;
  runtimeStore?: ProjectRuntimeStore;
}

export type ProjectCanvasApResourcePaneKind =
  | "apEvents"
  | "apHistory"
  | "apMetrics";

export type ProjectCanvasDbResourcePaneKind = "dbMetrics";

export type ProjectCanvasResourcePaneRenderModel =
  | {
      kind: ProjectCanvasApResourcePaneKind;
      node: Node;
      target: ProjectApTarget;
    }
  | {
      databaseData: CanvasDatabaseNodeData;
      kind: ProjectCanvasDbResourcePaneKind;
      node: Node;
      target: ProjectDbTarget;
    }
  | {
      databaseData?: CanvasDatabaseNodeData;
      entryNode?: Node | null;
      kind: "settings";
      node?: Node | null;
      target: ProjectSideSurfaceEntry & { kind: "settings" };
    };

export interface ProjectCanvasPendingTargetRenderModel<
  TEntry extends
    ProjectCanvasPendingTargetEntry = ProjectCanvasPendingTargetEntry,
> {
  entry: TEntry;
  kind: "pendingTarget";
  target: ProjectSurfaceTarget;
}

export type ProjectCanvasSideRenderModel =
  | {
      content: ProjectCanvasResourcePaneRenderModel;
      kind: "resource";
    }
  | {
      entry: ProjectGlobalSidePaneEntry;
      kind: "global";
    }
  | ProjectCanvasPendingTargetRenderModel<ProjectCanvasTargetedSideEntry>
  | null;

export type ProjectCanvasMainRenderModel =
  | {
      databaseData: CanvasDatabaseNodeData;
      kind: "dbAccess";
      node: Node;
      target: ProjectDbTarget;
    }
  | {
      kind: "apLogs";
      node: Node;
      target: ProjectApTarget;
    }
  | {
      kind: "dbLogs";
      node: Node;
      target: ProjectDbTarget;
    }
  | ProjectCanvasPendingTargetRenderModel<ProjectMainSurfaceEntry>
  | null;

export type ProjectCanvasDrawerRenderModel =
  | {
      kind: "apTerminal";
      node: Node;
      target: ProjectApTarget;
    }
  | {
      kind: "dbTerminal";
      node: Node;
      target: ProjectDbTarget;
    }
  | ProjectCanvasPendingTargetRenderModel<ProjectDrawerSurfaceEntry>
  | null;

export interface ProjectCanvasSurfaceRenderModel {
  drawer: ProjectCanvasDrawerRenderModel;
  main: ProjectCanvasMainRenderModel;
  side: ProjectCanvasSideRenderModel;
}

function pendingTargetModel<TEntry extends ProjectCanvasPendingTargetEntry>(
  entry: TEntry
): ProjectCanvasPendingTargetRenderModel<TEntry> {
  return { entry, kind: "pendingTarget", target: entry.target };
}

function isRuntimeDatabaseModel(
  model: ProjectRuntimeNodeModel | undefined
): model is CanvasDatabaseNodeData {
  return model !== undefined && "connections" in model && "workload" in model;
}

function databaseDataForNode(
  node: Node | null,
  runtime: ProjectRuntimeModelReader
): CanvasDatabaseNodeData | null {
  if (node == null) {
    return null;
  }
  const runtimeLookup = projectRuntimeShellLookupFromNodeData(node.data);
  if (runtimeLookup?.kind === "DB") {
    const model = runtimeModelForLookup(runtimeLookup, runtime);
    return isRuntimeDatabaseModel(model) ? model : null;
  }
  return databaseNodeDataFromNode(node);
}

function runtimeModelForLookup(
  lookup: ProjectRuntimeShellLookup,
  runtime: ProjectRuntimeModelReader
): ProjectRuntimeNodeModel | undefined {
  if (runtime.runtimeStore !== undefined) {
    switch (lookup.kind) {
      case "AP": {
        const fact = runtime.runtimeStore.selectApFact(lookup.modelKey);
        return fact === undefined
          ? undefined
          : projectRuntimeNodeModelFromFact(lookup.kind, fact);
      }
      case "DB": {
        const fact = runtime.runtimeStore.selectDbFact(lookup.modelKey);
        return fact === undefined
          ? undefined
          : projectRuntimeNodeModelFromFact(lookup.kind, fact);
      }
      case "PublicAccess": {
        const fact = runtime.runtimeStore.selectPublicAccessFact(
          lookup.modelKey
        );
        return fact === undefined
          ? undefined
          : projectRuntimeNodeModelFromFact(lookup.kind, fact);
      }
      case "TemplateNativeWorkload": {
        const fact = runtime.runtimeStore.selectTemplateNativeWorkloadFact(
          lookup.modelKey
        );
        return fact === undefined
          ? undefined
          : projectRuntimeNodeModelFromFact(lookup.kind, fact);
      }
      default:
        return undefined;
    }
  }
  switch (lookup.kind) {
    case "AP":
    case "TemplateNativeWorkload":
      return runtime.runtimeNodeModels?.containerModelsByKey.get(
        lookup.modelKey
      );
    case "DB":
      return runtime.runtimeNodeModels?.databaseModelsByKey.get(
        lookup.modelKey
      );
    case "PublicAccess":
      return runtime.runtimeNodeModels?.entryModelsByKey.get(lookup.modelKey);
    default:
      return undefined;
  }
}

function runtimeContainerNodeForNode(
  node: Node | null,
  runtime: ProjectRuntimeModelReader
): Node | null {
  if (node == null) {
    return null;
  }
  const runtimeLookup = projectRuntimeShellLookupFromNodeData(node?.data);
  if (runtimeLookup?.kind !== "AP") {
    return node;
  }
  const containerData = runtimeModelForLookup(runtimeLookup, runtime);
  return containerData === undefined
    ? null
    : { ...node, data: { ...node.data, ...containerData } };
}

function runtimeDatabaseNodeForNode(
  node: Node | null,
  runtime: ProjectRuntimeModelReader
): Node | null {
  if (node == null) {
    return null;
  }
  const runtimeLookup = projectRuntimeShellLookupFromNodeData(node.data);
  if (runtimeLookup?.kind !== "DB") {
    return databaseNodeDataFromNode(node) == null ? null : node;
  }
  const databaseData = databaseDataForNode(node, runtime);
  if (databaseData == null) {
    return null;
  }
  return { ...node, data: { ...node.data, ...databaseData } };
}

function apResourcePaneModel(
  nodes: readonly Node[],
  entry: Extract<
    ProjectSideSurfaceEntry,
    { kind: ProjectCanvasApResourcePaneKind }
  >,
  runtime: ProjectRuntimeModelReader
): ProjectCanvasSideRenderModel {
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  const renderNode = runtimeContainerNodeForNode(node, runtime);
  if (renderNode == null) {
    return pendingTargetModel(entry);
  }
  return {
    content: { kind: entry.kind, node: renderNode, target: entry.target },
    kind: "resource",
  };
}

function dbResourcePaneModel(
  nodes: readonly Node[],
  entry: Extract<
    ProjectSideSurfaceEntry,
    { kind: ProjectCanvasDbResourcePaneKind }
  >,
  runtime: ProjectRuntimeModelReader
): ProjectCanvasSideRenderModel {
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  const renderNode = runtimeDatabaseNodeForNode(node, runtime);
  if (renderNode == null) {
    return pendingTargetModel(entry);
  }
  return {
    content: {
      databaseData: renderNode.data as CanvasDatabaseNodeData,
      kind: entry.kind,
      node: renderNode,
      target: entry.target,
    },
    kind: "resource",
  };
}

function settingsPaneModel(
  nodes: readonly Node[],
  entry: Extract<ProjectSideSurfaceEntry, { kind: "settings" }>,
  runtime: ProjectRuntimeModelReader
): ProjectCanvasSideRenderModel {
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  const dbRenderNode =
    entry.target.kind === "DB"
      ? runtimeDatabaseNodeForNode(node, runtime)
      : null;
  const renderNode =
    entry.target.kind === "AP"
      ? runtimeContainerNodeForNode(node, runtime)
      : (dbRenderNode ?? node);
  const databaseData =
    dbRenderNode == null
      ? undefined
      : (dbRenderNode.data as CanvasDatabaseNodeData);

  const entryNode =
    entry.target.kind === "AP" && entry.view === "public-addresses"
      ? findCanvasNodeForProjectTarget(nodes, {
          apName: entry.target.name,
          kind: "PublicAccess",
          namespace: entry.target.namespace,
        })
      : undefined;

  return {
    content: {
      ...(databaseData == null ? {} : { databaseData }),
      ...(entryNode === undefined ? {} : { entryNode }),
      kind: "settings",
      node: renderNode,
      target: entry,
    },
    kind: "resource",
  };
}

function sideRenderModel({
  nodes,
  runtime,
  surfaceState,
}: {
  nodes: readonly Node[];
  runtime: ProjectRuntimeModelReader;
  surfaceState: Pick<ProjectSurfaceState, "main" | "side">;
}): ProjectCanvasSideRenderModel {
  const entry = surfaceState.side;
  if (entry == null || !projectSideSurfaceVisible(surfaceState)) {
    return null;
  }

  switch (entry.kind) {
    case "apEvents":
    case "apHistory":
    case "apMetrics":
      return apResourcePaneModel(nodes, entry, runtime);
    case "dbMetrics":
      return dbResourcePaneModel(nodes, entry, runtime);
    case "settings":
      return settingsPaneModel(nodes, entry, runtime);
    case "databaseDeployment":
    case "deploymentTaskTimeline":
    case "dockerDeployment":
    case "githubDeployment":
    case "projectCreation":
    case "skillsWorkflow":
    case "templateDeployment":
      return { entry, kind: "global" };
    default:
      return entry satisfies never;
  }
}

function dbAccessMainModel(
  nodes: readonly Node[],
  entry: Extract<ProjectMainSurfaceEntry, { kind: "dbAccess" }>,
  runtime: ProjectRuntimeModelReader
): ProjectCanvasMainRenderModel {
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  const renderNode = runtimeDatabaseNodeForNode(node, runtime);
  if (renderNode == null) {
    return pendingTargetModel(entry);
  }
  return {
    databaseData: renderNode.data as CanvasDatabaseNodeData,
    kind: "dbAccess",
    node: renderNode,
    target: entry.target,
  };
}

function resourceLogsMainModel(
  nodes: readonly Node[],
  entry: Extract<ProjectMainSurfaceEntry, { kind: "resourceLogs" }>,
  runtime: ProjectRuntimeModelReader
): ProjectCanvasMainRenderModel {
  const foundNode = findCanvasNodeForProjectTarget(nodes, entry.target);
  const node =
    entry.target.kind === "AP"
      ? runtimeContainerNodeForNode(foundNode, runtime)
      : runtimeDatabaseNodeForNode(foundNode, runtime);
  if (node == null) {
    return pendingTargetModel(entry);
  }
  if (entry.target.kind === "AP") {
    return { kind: "apLogs", node, target: entry.target };
  }
  return { kind: "dbLogs", node, target: entry.target };
}

function mainRenderModel(
  nodes: readonly Node[],
  entry: ProjectMainSurfaceEntry | null,
  runtime: ProjectRuntimeModelReader
): ProjectCanvasMainRenderModel {
  if (entry == null) {
    return null;
  }
  switch (entry.kind) {
    case "dbAccess":
      return dbAccessMainModel(nodes, entry, runtime);
    case "resourceLogs":
      return resourceLogsMainModel(nodes, entry, runtime);
    default:
      return entry satisfies never;
  }
}

function drawerRenderModel(
  nodes: readonly Node[],
  entry: ProjectDrawerSurfaceEntry | null,
  runtime: ProjectRuntimeModelReader
): ProjectCanvasDrawerRenderModel {
  if (entry == null) {
    return null;
  }
  const node = findCanvasNodeForProjectTarget(nodes, entry.target);
  if (node == null) {
    return pendingTargetModel(entry);
  }
  switch (entry.kind) {
    case "apTerminal": {
      const runtimeNode = runtimeContainerNodeForNode(node, runtime);
      return runtimeNode == null
        ? pendingTargetModel(entry)
        : { kind: "apTerminal", node: runtimeNode, target: entry.target };
    }
    case "dbTerminal": {
      const runtimeNode = runtimeDatabaseNodeForNode(node, runtime);
      return runtimeNode == null
        ? pendingTargetModel(entry)
        : { kind: "dbTerminal", node: runtimeNode, target: entry.target };
    }
    default:
      return entry satisfies never;
  }
}

export function createProjectCanvasSideRenderModel({
  nodes,
  runtimeNodeModels,
  runtimeStore,
  surfaceState,
}: ProjectCanvasSurfaceRenderModelInput & {
  surfaceState: Pick<ProjectSurfaceState, "main" | "side">;
}): ProjectCanvasSideRenderModel {
  const runtime = { runtimeNodeModels, runtimeStore };
  return sideRenderModel({ nodes, runtime, surfaceState });
}

export function createProjectCanvasMainRenderModel({
  entry,
  nodes,
  runtimeNodeModels,
  runtimeStore,
}: ProjectCanvasSurfaceRenderModelInput & {
  entry: ProjectMainSurfaceEntry | null;
}): ProjectCanvasMainRenderModel {
  const runtime = { runtimeNodeModels, runtimeStore };
  return mainRenderModel(nodes, entry, runtime);
}

export function createProjectCanvasDrawerRenderModel({
  entry,
  nodes,
  runtimeNodeModels,
  runtimeStore,
}: ProjectCanvasSurfaceRenderModelInput & {
  entry: ProjectDrawerSurfaceEntry | null;
}): ProjectCanvasDrawerRenderModel {
  const runtime = { runtimeNodeModels, runtimeStore };
  return drawerRenderModel(nodes, entry, runtime);
}

export function createProjectCanvasSurfaceRenderModel({
  nodes,
  runtimeNodeModels,
  runtimeStore,
  surfaceState,
}: ProjectCanvasSurfaceRenderModelInput & {
  surfaceState: ProjectSurfaceState;
}): ProjectCanvasSurfaceRenderModel {
  const runtime = { runtimeNodeModels, runtimeStore };
  return {
    drawer: drawerRenderModel(nodes, surfaceState.drawer, runtime),
    main: mainRenderModel(nodes, surfaceState.main, runtime),
    side: sideRenderModel({ nodes, runtime, surfaceState }),
  };
}
