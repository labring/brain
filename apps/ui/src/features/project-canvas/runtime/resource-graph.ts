import type { CanvasState } from "@workspace/ui/components/canvas/canvas.types";
import type { Node } from "@xyflow/react";
import type { DeploymentTaskProjection } from "@/features/deploy/task/projection";
import {
  type CanvasDetectedConnection,
  canvasConnectionEdgesFromDetectedConnections,
} from "@/features/project-canvas/flow/detected-connections";
import { mergeCanvasLayoutWithDetectedNodes } from "@/features/project-canvas/layout/merge";
import {
  canvasPlacementOwnerKey,
  resourcePlacementOwner,
} from "@/features/project-canvas/layout/placement-owner";
import type {
  CanvasLayoutDocument,
  CanvasLayoutNode,
  CanvasLayoutResourceRef,
  PlacementCommand,
} from "@/features/project-canvas/layout/types";
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "@/features/project-canvas/nodes/constants";
import type { ProjectRuntimeRelationshipIndexes } from "@/features/project-canvas/runtime/resource-relationships";
import type {
  ProjectRuntimeResourceTopologyItem,
  ProjectRuntimeShellKind,
  ProjectRuntimeShellNodeData,
} from "@/features/project-canvas/runtime/resource-store";
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
  resourceTopology: readonly ProjectRuntimeResourceTopologyItem[];
  retainedLayoutOwnerKeys?: ReadonlySet<string>;
}

const FALLBACK_COLUMNS = 3;
const FALLBACK_COL_GAP = 340;
const FALLBACK_ROW_GAP = 280;

function fallbackGeneratedCanvasPosition(index: number): {
  x: number;
  y: number;
} {
  return {
    x: (index % FALLBACK_COLUMNS) * FALLBACK_COL_GAP,
    y: Math.floor(index / FALLBACK_COLUMNS) * FALLBACK_ROW_GAP,
  };
}

function stableNodeName(name: string): string {
  return name.replace(/\s+/g, "-");
}

function resourceShellData(
  kind: ProjectRuntimeShellKind,
  key: string,
  ref: CanvasLayoutResourceRef,
  observedUid: string | undefined
): ProjectRuntimeShellNodeData {
  const owner = resourcePlacementOwner(ref);
  return {
    runtime: {
      kind,
      modelKey: key,
      ...(observedUid === undefined ? {} : { observedUid }),
      placementOwnerKey: canvasPlacementOwnerKey(owner),
      resourceRef: ref,
    },
  };
}

export function projectCanvasRuntimeShellNodesFromResources(
  resourceTopology: readonly ProjectRuntimeResourceTopologyItem[]
): Node<ProjectRuntimeShellNodeData>[] {
  return resourceTopology.map((item, index) => {
    const position = fallbackGeneratedCanvasPosition(index);
    switch (item.kind) {
      case "AP":
        return {
          data: resourceShellData(
            item.kind,
            item.modelKey,
            item.ref,
            item.observedUid
          ),
          id: `ap-${stableNodeName(item.ref.name)}`,
          position,
          type: CANVAS_CONTAINER_NODE_TYPE,
        };
      case "DB":
        return {
          data: resourceShellData(
            item.kind,
            item.modelKey,
            item.ref,
            item.observedUid
          ),
          id: `db-${stableNodeName(item.ref.name)}`,
          position,
          type: CANVAS_DATABASE_NODE_TYPE,
        };
      case "PublicAccess":
        return {
          data: resourceShellData(
            item.kind,
            item.modelKey,
            item.ref,
            item.observedUid
          ),
          id: `entry-${stableNodeName(item.ref.name)}`,
          position,
          type: CANVAS_ENTRY_NODE_TYPE,
        };
      default:
        return item satisfies never;
    }
  });
}

export function projectCanvasRuntimeResourceGraph({
  canvasLayout,
  canvasLayoutReady = true,
  deployTasks,
  layoutCommands,
  relationshipIndexes,
  resourceTopology,
  retainedLayoutOwnerKeys,
}: ProjectCanvasRuntimeResourceGraphInput): ProjectCanvasRuntimeResourceGraph {
  const shellNodes =
    projectCanvasRuntimeShellNodesFromResources(resourceTopology);
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
