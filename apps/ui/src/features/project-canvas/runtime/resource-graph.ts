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
import { deploymentHandoffReconciliations } from "../snapshot/deployment-handoff-reconciliation";
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
  | {
      commands: PlacementCommand[];
      expectedVersion: number;
      kind: "transaction";
      nodes: CanvasLayoutNode[];
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
  now: Date;
  relationshipIndexes: ProjectRuntimeRelationshipIndexes;
  resourceTopology: readonly ProjectRuntimeResourceTopologyItem[];
  retainedLayoutOwnerKeys?: ReadonlySet<string>;
}

interface ProjectCanvasResourceGraphMaterialization {
  edges: CanvasState["edges"];
  layoutIntent: ProjectCanvasLayoutIntent | null;
  nodes: CanvasState["nodes"];
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

function canvasLayoutWithPersistedState(
  layout: CanvasLayoutDocument | undefined
): CanvasLayoutDocument | undefined {
  // The repository represents an absent row as an empty version-zero document.
  return layout?.version === 0 && layout.nodes.length === 0
    ? undefined
    : layout;
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

export function projectCanvasRuntimeResourceGraph(
  input: ProjectCanvasRuntimeResourceGraphInput
): ProjectCanvasRuntimeResourceGraph {
  const materialized = materializeProjectCanvasResourceGraph(input);
  return {
    canvasState: {
      edges: materialized.edges,
      nodes: materialized.nodes,
      selectedEdge: null,
      selectedNode: null,
    },
    layoutIntent: materialized.layoutIntent,
  };
}

function materializeProjectCanvasResourceGraph({
  canvasLayout,
  canvasLayoutReady = true,
  deployTasks,
  layoutCommands,
  now,
  relationshipIndexes,
  resourceTopology,
  retainedLayoutOwnerKeys,
}: ProjectCanvasRuntimeResourceGraphInput): ProjectCanvasResourceGraphMaterialization {
  if (!canvasLayoutReady) {
    return {
      edges: [],
      layoutIntent: null,
      nodes: [],
    };
  }

  const persistedCanvasLayout = canvasLayoutWithPersistedState(canvasLayout);

  const shellNodes =
    projectCanvasRuntimeShellNodesFromResources(resourceTopology);
  const deploymentResultPreviews =
    deploymentResultPreviewsFromTasks(deployTasks);
  const rawDeploymentProjectionContext = createDeploymentProjectionContext({
    layout: persistedCanvasLayout,
    nodes: shellNodes,
    previews: deploymentResultPreviews,
    tasks: deployTasks,
  });
  const handoffReconciliations = deploymentHandoffReconciliations(
    rawDeploymentProjectionContext
  );
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
      now,
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
  const initialPositionByRef = deploymentPlaceholderHandoffs({
    context: rawDeploymentProjectionContext,
    reconciliations: handoffReconciliations,
  });
  const detectedConnections: CanvasDetectedConnection[] = [
    ...relationshipIndexes.publicAccessToAp,
    ...relationshipIndexes.apToDb,
  ];
  const merge = mergeCanvasLayoutWithDetectedNodes({
    connections: detectedConnections,
    initialPositionByRef,
    layout: persistedCanvasLayout,
    nodes: [...detectedNodes, ...deploymentPlaceholderNodes],
    now,
    retainedLayoutOwnerKeys,
  });
  const edges = canvasConnectionEdgesFromDetectedConnections(
    detectedConnections,
    merge.nodes
  );
  const mergedDeploymentProjectionContext = createDeploymentProjectionContext({
    layout: persistedCanvasLayout,
    nodes: merge.nodes,
    previews: deploymentResultPreviews,
    tasks: deployTasks,
  });
  const deploymentPreviewEdges = deploymentPreviewEdgesFromTasks({
    context: mergedDeploymentProjectionContext,
    existingEdges: edges,
  });
  const commands = [
    ...(layoutCommands ?? []),
    ...deploymentProjectionPlacementCommands({
      context: mergedDeploymentProjectionContext,
      now,
      reconciliations: handoffReconciliations,
    }),
  ];
  const commandSourceByOwnerKey = new Map(
    commands.flatMap((command) =>
      command.kind === "create" || command.kind === "move"
        ? [[canvasPlacementOwnerKey(command.owner), command.source] as const]
        : []
    )
  );
  const placedLayoutNodes = merge.placedLayoutNodes.map((node) => {
    const reconciliation = handoffReconciliations.get(
      canvasPlacementOwnerKey(node.owner)
    );
    const source =
      reconciliation === undefined
        ? commandSourceByOwnerKey.get(canvasPlacementOwnerKey(node.owner))
        : (reconciliation.source ?? node.source);
    return source === undefined ? node : { ...node, source };
  });
  const layoutIntent = layoutIntentFromMerge({
    changed: merge.changed,
    commands,
    layout: merge.layout,
    placedLayoutNodes,
  });

  return {
    edges: [...edges, ...deploymentPreviewEdges],
    layoutIntent,
    nodes: merge.nodes,
  };
}

function layoutIntentFromMerge(input: {
  changed: boolean;
  commands: PlacementCommand[];
  layout: CanvasLayoutDocument | undefined;
  placedLayoutNodes: CanvasLayoutNode[];
}): ProjectCanvasLayoutIntent | null {
  if (input.layout === undefined) {
    return input.placedLayoutNodes.length === 0
      ? null
      : { kind: "first-placement", nodes: input.placedLayoutNodes };
  }

  const nodes = [
    ...(input.changed ? input.layout.nodes : []),
    ...input.placedLayoutNodes,
  ];
  if (input.commands.length > 0 || nodes.length > 0) {
    return {
      commands: input.commands,
      expectedVersion: input.layout.version,
      kind: "transaction",
      nodes,
    };
  }
  return null;
}
