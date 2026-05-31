import type {
  ContainerNodeActions,
  ContainerNodeStates,
} from "@workspace/ui/components/container-node/container-node";
import type {
  ContainerSettingsPaneAddDbDsnReferenceIntent,
  ContainerSettingsPaneConfirmedAddDbDsnReference,
} from "@workspace/ui/components/container-settings-pane/container-settings-pane";
import type {
  DatabaseNodeActions,
  DatabaseNodeConnection,
  DatabaseNodeStates,
} from "@workspace/ui/components/database-node/database-node";
import type {
  EntryNodeAccessDomain,
  EntryNodeActions,
  EntryNodeStates,
  EntryNodeTarget,
} from "@workspace/ui/components/entry-node/entry-node";
import type { ContainerEnvDbDsnSource } from "@workspace/ui/lib/container-env-rows";
import type { Node } from "@xyflow/react";

// `Node`'s second type parameter must match the node type constants in ./constants.
// biome-ignore lint/style/useImportType: value required for `typeof` in `CanvasContainerRfNode`
import {
  CANVAS_CONTAINER_NODE_TYPE,
  CANVAS_DATABASE_NODE_TYPE,
  CANVAS_ENTRY_NODE_TYPE,
} from "./constants";

export interface CanvasNodeLayoutState {
  expanded?: boolean;
  generatedPosition?: { x: number; y: number };
  onExpandedChange?: (node: Node, expanded: boolean) => void;
  positionSource?: "generated";
}

export interface CanvasNodeSettingsAccess {
  readOnly?: boolean;
  shareToken?: string;
}

export interface CanvasContainerNodeData extends Record<string, unknown> {
  actions?: ContainerNodeActions;
  addDbDsnReferenceIntent?: ContainerSettingsPaneAddDbDsnReferenceIntent | null;
  dbDsnReferenceSources?: ContainerEnvDbDsnSource[];
  layout?: CanvasNodeLayoutState;
  onAddDbDsnReferenceIntentConsumed?: (id: string) => void;
  onAddDbDsnReferenceMutationStart?: (
    references: readonly ContainerSettingsPaneConfirmedAddDbDsnReference[]
  ) => (() => void) | undefined;
  onWorkloadMutation?: () => Promise<unknown>;
  settingsAccess?: CanvasNodeSettingsAccess;
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

export interface CanvasDatabaseNodeData extends Record<string, unknown> {
  actions?: DatabaseNodeActions;
  connections: DatabaseNodeConnection[];
  desired?: {
    cpuLimit?: string;
    cpuRequest?: string;
    exposeNodePort?: boolean;
    memoryLimit?: string;
    memoryRequest?: string;
    replicas?: number;
    storageSize?: string;
  };
  layout?: CanvasNodeLayoutState;
  metadata?: {
    labels?: Record<string, unknown>;
  };
  settingsAccess?: CanvasNodeSettingsAccess;
  states: DatabaseNodeStates;
  uid?: string;
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
