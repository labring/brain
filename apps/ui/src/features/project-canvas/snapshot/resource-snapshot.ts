import type { K8sGetResponse } from "@workspace/api/schemas/k8s-get";
import type { CanvasState } from "@workspace/ui/components/canvas/canvas.types";
import {
  apLikeWorkloadKeysFromList,
  apsToCanvasState,
  dbsToCanvasState,
  publicAccessToCanvasState,
  templateNativeWorkloadsToCanvasState,
} from "@/features/project-canvas/flow/ap-list-to-canvas-state";
import {
  canvasConnectionEdgesFromDetectedConnections,
  detectCanvasConnections,
} from "@/features/project-canvas/flow/detected-connections";
import { mergeCanvasLayoutWithDetectedNodes } from "@/features/project-canvas/layout/merge";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  PlacementCommand,
} from "@/features/project-canvas/layout/types";
import {
  type ApEnvironmentDbReferenceSource,
  apEnvironmentDbReferenceSourcesFromDbsData,
} from "@/features/project-settings/ap/k8s/db-dsn-reference-sources";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import {
  deploymentPlaceholderHandoffs,
  deploymentPlaceholderPendingResultKeys,
  isDeploymentPlaceholderPendingResultNode,
} from "./deployment-placeholder-handoff";
import {
  deploymentPlaceholderNodesFromTasks,
  shouldHideDeploymentPlaceholderForHandoff,
} from "./deployment-placeholder-nodes";
import { deploymentProjectionPlacementCommands } from "./deployment-placement-commands";
import { deploymentPreviewEdgesFromTasks } from "./deployment-preview-edges";
import { projectCanvasFrameState } from "./project-canvas-page-state";

export type ProjectCanvasLayoutIntent =
  | { kind: "first-placement"; nodes: CanvasLayoutNode[] }
  | { kind: "merge"; nodes: CanvasLayoutNode[] }
  | {
      commands: PlacementCommand[];
      expectedVersion: number;
      kind: "placement-commands";
    };

export interface ProjectCanvasResourceSnapshotInput {
  apsData?: K8sGetResponse;
  canvasLayout?: CanvasLayoutDocument;
  canvasLayoutReady?: boolean;
  dbsData?: K8sGetResponse;
  deployTasks?: DeploymentTaskProjection[];
  error?: Error;
  isEmptyGraphLoading: boolean;
  kubeconfig: string;
  layoutCommands?: PlacementCommand[];
  namespace: string;
  retainedLayoutOwnerKeys?: ReadonlySet<string>;
  templateNativeData?: {
    deployments?: K8sGetResponse;
    statefulSets?: K8sGetResponse;
  };
}

export interface ProjectCanvasResourceSnapshot {
  apEnvironmentDbReferenceSources: ApEnvironmentDbReferenceSource[];
  canvasState: CanvasState;
  frameState: ReturnType<typeof projectCanvasFrameState>;
  layoutIntent: ProjectCanvasLayoutIntent | null;
}

const EMPTY_TEMPLATE_NATIVE_DATA = {};

export function buildProjectCanvasResourceSnapshot({
  apsData,
  canvasLayout,
  canvasLayoutReady = true,
  dbsData,
  deployTasks,
  error,
  isEmptyGraphLoading,
  kubeconfig,
  layoutCommands,
  namespace,
  retainedLayoutOwnerKeys,
  templateNativeData = EMPTY_TEMPLATE_NATIVE_DATA,
}: ProjectCanvasResourceSnapshotInput): ProjectCanvasResourceSnapshot {
  const apEnvironmentDbReferenceSources =
    apEnvironmentDbReferenceSourcesFromDbsData(dbsData, namespace);
  const apBlock = apsToCanvasState(apsData, {
    gridIndexOffset: 0,
    namespaceFallback: namespace,
  });
  const dbBlock = dbsToCanvasState(dbsData, {
    gridIndexOffset: apBlock.nodes.length,
    namespaceFallback: namespace,
  });
  const publicAccessBlock = publicAccessToCanvasState(apsData, {
    gridIndexOffset: apBlock.nodes.length + dbBlock.nodes.length,
    namespaceFallback: namespace,
  });
  const apLikeWorkloadKeys = apLikeWorkloadKeysFromList(apsData, {
    namespaceFallback: namespace,
  });
  const templateNativeBlock = templateNativeWorkloadsToCanvasState(
    templateNativeData,
    {
      apLikeWorkloadKeys,
      gridIndexOffset:
        apBlock.nodes.length +
        dbBlock.nodes.length +
        publicAccessBlock.nodes.length,
      namespaceFallback: namespace,
    }
  );
  const rawDetectedNodes = [
    ...apBlock.nodes,
    ...dbBlock.nodes,
    ...publicAccessBlock.nodes,
    ...templateNativeBlock.nodes,
  ];
  const pendingResultKeys = deploymentPlaceholderPendingResultKeys({
    layout: canvasLayout,
    nodes: rawDetectedNodes,
    tasks: deployTasks,
  });
  const detectedNodes = rawDetectedNodes.filter(
    (node) =>
      !isDeploymentPlaceholderPendingResultNode({
        keys: pendingResultKeys,
        node,
      })
  );
  const deployTaskById = new Map(
    (deployTasks ?? []).map((task) => [task.id, task])
  );
  const deploymentPlaceholderNodes = deploymentPlaceholderNodesFromTasks(
    deployTasks,
    {
      layout: canvasLayout,
      nodes: rawDetectedNodes,
    }
  ).filter((node) => {
    if (!deployTaskById.has(node.data.taskId)) {
      return true;
    }
    return !shouldHideDeploymentPlaceholderForHandoff({
      layout: canvasLayout,
      node,
      nodes: rawDetectedNodes,
    });
  });
  const initialPositions = deploymentPlaceholderHandoffs({
    layout: canvasLayout,
    nodes: detectedNodes,
    tasks: deployTasks,
  });
  const detectedConnections = canvasLayoutReady
    ? detectCanvasConnections({
        apEnvironmentDbReferenceSources,
        apsData,
        dbsData,
        namespaceFallback: namespace,
      })
    : [];
  const merge = canvasLayoutReady
    ? mergeCanvasLayoutWithDetectedNodes({
        connections: detectedConnections,
        initialPositionByNodeId: initialPositions.byNodeId,
        initialPositionByRef: initialPositions.byRef,
        layout: canvasLayout,
        nodes: [...detectedNodes, ...deploymentPlaceholderNodes],
        retainedLayoutOwnerKeys,
      })
    : {
        changed: false,
        layout: canvasLayout,
        nodes: [],
        placedLayoutNodes: [],
      };
  const edges = canvasLayoutReady
    ? canvasConnectionEdgesFromDetectedConnections(
        detectedConnections,
        merge.nodes
      )
    : [];
  const deploymentPreviewEdges = canvasLayoutReady
    ? deploymentPreviewEdgesFromTasks({
        existingEdges: edges,
        nodes: merge.nodes,
        tasks: deployTasks,
      })
    : [];
  const canvasState: CanvasState = {
    edges: [...edges, ...deploymentPreviewEdges, ...templateNativeBlock.edges],
    nodes: merge.nodes,
    selectedEdge: null,
    selectedNode: null,
  };
  const layoutIntent = layoutIntentFromMerge({
    changed: merge.changed,
    commands: [
      ...(layoutCommands ?? []),
      ...deploymentProjectionPlacementCommands({
        layout: canvasLayout,
        nodes: rawDetectedNodes,
        tasks: deployTasks,
      }),
    ],
    layout: merge.layout,
    placedLayoutNodes: merge.placedLayoutNodes,
  });

  return {
    apEnvironmentDbReferenceSources,
    canvasState,
    frameState: projectCanvasFrameState({
      edgeCount: canvasState.edges.length,
      error,
      isEmptyGraphLoading,
      kubeconfig,
      nodeCount: canvasState.nodes.length,
    }),
    layoutIntent,
  };
}

function layoutIntentFromMerge(input: {
  changed: boolean;
  commands: PlacementCommand[];
  layout: CanvasLayoutDocument | undefined;
  placedLayoutNodes: CanvasLayoutNode[];
}): ProjectCanvasLayoutIntent | null {
  if (input.commands.length > 0 && input.layout !== undefined) {
    return {
      commands: input.commands,
      expectedVersion: input.layout.version,
      kind: "placement-commands",
    };
  }
  if (input.placedLayoutNodes.length > 0) {
    return { kind: "first-placement", nodes: input.placedLayoutNodes };
  }
  if (!(input.changed && input.layout !== undefined)) {
    return null;
  }
  return { kind: "merge", nodes: input.layout.nodes };
}
