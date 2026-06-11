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
import type {
  ApSettingsAddDbDsnReferenceIntent,
  ApSettingsConfirmedAddDbDsnReference,
  ApSettingsPendingDbReference,
} from "@/features/project-settings/ap/ap-settings-sections";
import type { ApEnvDbDsnSource } from "@/features/project-settings/ap/lib/ap-env-rows";
import type { DbSettingsData } from "@/features/project-settings/db/db-settings-types";

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
}

export interface CanvasContainerNodeData extends Record<string, unknown> {
  actions?: ContainerNodeActions;
  addDbDsnReferenceIntent?: ApSettingsAddDbDsnReferenceIntent | null;
  dbDsnReferenceSources?: ApEnvDbDsnSource[];
  layout?: CanvasNodeLayoutState;
  onAddDbDsnReferenceIntentConsumed?: (id: string) => void;
  onAddDbDsnReferenceMutationStart?: (
    references: readonly ApSettingsConfirmedAddDbDsnReference[]
  ) => (() => void) | undefined;
  onPendingDbReferencesChange?: (
    references: readonly ApSettingsPendingDbReference[]
  ) => void;
  onWorkloadMutation?: () => Promise<unknown>;
  resourceKind?: "ap" | "template";
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

export interface CanvasDatabaseNodeData extends DbSettingsData {
  actions?: DatabaseNodeActions;
  layout?: CanvasNodeLayoutState;
  settingsAccess?: CanvasNodeSettingsAccess;
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
