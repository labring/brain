import type { CanvasState } from "@workspace/ui/components/canvas/canvas.types";
import type { Node } from "@xyflow/react";
import {
  type CanvasDetectedConnection,
  canvasConnectionEdgesFromDetectedConnections,
} from "@/features/project-canvas/flow/detected-connections";
import { mergeCanvasLayoutWithDetectedNodes } from "@/features/project-canvas/layout/merge";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  PlacementCommand,
} from "@/features/project-canvas/layout/types";
import type { ProjectRuntimeRelationshipIndexes } from "@/features/project-runtime/resource-relationships";
import type { ProjectRuntimeShellNodeData } from "@/features/project-runtime/resource-store";
import type { DeploymentTaskProjection } from "@/lib/deploy-task/projection";
import {
  deploymentPlaceholderHandoffs,
  deploymentPlaceholderPendingResultKeys,
  isDeploymentPlaceholderPendingResultNode,
} from "../snapshot/deployment-placeholder-handoff";
import {
  deploymentPlaceholderNodesFromTasks,
  shouldHideDeploymentPlaceholderForHandoff,
} from "../snapshot/deployment-placeholder-nodes";
import { deploymentProjectionPlacementCommands } from "../snapshot/deployment-placement-commands";
import { deploymentPreviewEdgesFromTasks } from "../snapshot/deployment-preview-edges";
import { createDeploymentProjectionContext } from "../snapshot/deployment-projection-context";
import { deploymentResultPreviewsFromTasks } from "../snapshot/deployment-projection-model";

export type ProjectCanvasLayoutIntent =
  | { kind: "first-placement"; nodes: CanvasLayoutNode[] }
  | { kind: "merge"; nodes: CanvasLayoutNode[] }
  | {
      commands: PlacementCommand[];
      expectedVersion: number;
      kind: "placement-commands";
    };

export interface ProjectCanvasRuntimeResourceGraph {
  canvasState: CanvasState;
  layoutIntent: ProjectCanvasLayoutIntent | null;
}

export interface ProjectCanvasRuntimeResourceGraphInput {
  canvasLayout?: CanvasLayoutDocument;
  canvasLayoutReady?: boolean;
  deployTasks?: DeploymentTaskProjection[];
  layoutCommands?: PlacementCommand[];
  relationshipIndexes: ProjectRuntimeRelationshipIndexes;
  retainedLayoutOwnerKeys?: ReadonlySet<string>;
  shellNodes: Node<ProjectRuntimeShellNodeData>[];
}

export function projectCanvasRuntimeResourceGraph({
  canvasLayout,
  canvasLayoutReady = true,
  deployTasks,
  layoutCommands,
  relationshipIndexes,
  retainedLayoutOwnerKeys,
  shellNodes,
}: ProjectCanvasRuntimeResourceGraphInput): ProjectCanvasRuntimeResourceGraph {
  const deploymentResultPreviews =
    deploymentResultPreviewsFromTasks(deployTasks);
  const rawDeploymentProjectionContext = createDeploymentProjectionContext({
    layout: canvasLayout,
    nodes: shellNodes,
    previews: deploymentResultPreviews,
    tasks: deployTasks,
  });
  const pendingResultKeys = deploymentPlaceholderPendingResultKeys({
    context: rawDeploymentProjectionContext,
  });
  const detectedNodes = shellNodes.filter(
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
      context: rawDeploymentProjectionContext,
    }
  ).filter((node) => {
    if (!deployTaskById.has(node.data.taskId)) {
      return true;
    }
    return !shouldHideDeploymentPlaceholderForHandoff({
      context: rawDeploymentProjectionContext,
      node,
    });
  });
  const initialPositions = deploymentPlaceholderHandoffs({
    context: rawDeploymentProjectionContext,
  });
  const detectedConnections: CanvasDetectedConnection[] = canvasLayoutReady
    ? [...relationshipIndexes.publicAccessToAp, ...relationshipIndexes.apToDb]
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
  const mergedDeploymentProjectionContext = createDeploymentProjectionContext({
    layout: canvasLayout,
    nodes: merge.nodes,
    previews: deploymentResultPreviews,
    tasks: deployTasks,
  });
  const deploymentPreviewEdges = canvasLayoutReady
    ? deploymentPreviewEdgesFromTasks({
        context: mergedDeploymentProjectionContext,
        existingEdges: edges,
      })
    : [];
  const canvasState: CanvasState = {
    edges: [...edges, ...deploymentPreviewEdges],
    nodes: merge.nodes,
    selectedEdge: null,
    selectedNode: null,
  };
  const layoutIntent = layoutIntentFromMerge({
    changed: merge.changed,
    commands: [
      ...(layoutCommands ?? []),
      ...deploymentProjectionPlacementCommands({
        context: mergedDeploymentProjectionContext,
      }),
    ],
    layout: merge.layout,
    placedLayoutNodes: merge.placedLayoutNodes,
  });

  return {
    canvasState,
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
