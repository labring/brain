import type {
  ContainerNodeActions,
  ContainerNodeStates,
} from "@workspace/ui/components/container-node/container-node";
import type {
  DatabaseNodeActions,
  DatabaseNodeStates,
} from "@workspace/ui/components/database-node/database-node";
import type {
  EntryNodeAccessDomain,
  EntryNodeActions,
  EntryNodeStates,
  EntryNodeTarget,
} from "@workspace/ui/components/entry-node/entry-node";
import type { Node } from "@xyflow/react";
import type { DbSettingsData } from "@/features/project-settings/db/db-settings-types";
import type {
  DeploymentTaskCanvasProjectionEdge,
  DeploymentTaskCanvasProjectionExpectedRef,
} from "@/lib/deploy-task/types";
import type {
  CanvasLayoutPosition,
  CanvasPlacementSource,
} from "../layout/types";

// `Node`'s second type parameter must match the node type constants in ./constants.
// biome-ignore lint/style/useImportType: value required for `typeof` in `CanvasContainerRfNode`
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "./constants";

export interface CanvasNodeLayoutState {
  expanded?: boolean;
  generatedPosition?: { x: number; y: number };
  onExpandedChange?: (node: Node, expanded: boolean) => void;
  positionSource?: "generated";
}

export interface CanvasContainerNodeData extends Record<string, unknown> {
  actions?: ContainerNodeActions;
  layout?: CanvasNodeLayoutState;
  resourceKind?: "ap" | "template";
  states: ContainerNodeStates;
}

export type CanvasContainerRfNode = Node<
  CanvasContainerNodeData,
  typeof CANVAS_CONTAINER_NODE_TYPE
>;

export interface CanvasDatabaseWorkloadRef {
  name: string;
  namespace: string;
}

export interface CanvasDatabaseNodeData extends DbSettingsData {
  actions?: DatabaseNodeActions;
  layout?: CanvasNodeLayoutState;
  states: DatabaseNodeStates;
  workload: CanvasDatabaseWorkloadRef;
}

export type CanvasDatabaseRfNode = Node<
  CanvasDatabaseNodeData,
  typeof CANVAS_DATABASE_NODE_TYPE
>;

export interface CanvasEntryNodeData extends Record<string, unknown> {
  accessDomain?: EntryNodeAccessDomain;
  actions?: EntryNodeActions;
  layout?: CanvasNodeLayoutState;
  resource: {
    apRef?: string;
    name: string;
    namespace: string;
    selectionKey?: string;
    uid?: string;
  };
  states: EntryNodeStates;
  targets: EntryNodeTarget[];
}

export type CanvasEntryRfNode = Node<
  CanvasEntryNodeData,
  typeof CANVAS_ENTRY_NODE_TYPE
>;

export interface CanvasDeploymentPlaceholderNodeData
  extends Record<string, unknown> {
  anchor?: boolean;
  expectedRef?: DeploymentTaskCanvasProjectionExpectedRef;
  groupId?: string;
  hasProjectionPlacement?: boolean;
  projectionEdges?: DeploymentTaskCanvasProjectionEdge[];
  projectionPlacementSource?: CanvasPlacementSource;
  projectionRelativePlacement?: { x: number; y: number };
  projectionSlots?: {
    anchor?: boolean;
    expectedRef?: DeploymentTaskCanvasProjectionExpectedRef;
    id: string;
    position?: CanvasLayoutPosition & { source?: CanvasPlacementSource };
  }[];
  slotId?: string;
  taskId: string;
}

export type CanvasDeploymentPlaceholderRfNode = Node<
  CanvasDeploymentPlaceholderNodeData,
  typeof CANVAS_DEPLOYMENT_PLACEHOLDER_NODE_TYPE
>;
