"use client";

import "./database-node.css";

import {
  DatabaseNodeActionBar,
  DatabaseNodeBodyContent,
  DatabaseNodeConnectionList,
  DatabaseNodeConnectionRow,
  DatabaseNodeContent,
  DatabaseNodeDeletionDelayHint,
  DatabaseNodeFooterContent,
  DatabaseNodeHeaderContent,
  DatabaseNodeMetricsContent,
} from "./database-node.content";
import { DatabaseNodeRoot } from "./database-node.root";

// biome-ignore lint/performance/noBarrelFile: compound component public API includes colocated helpers.
export {
  databaseNodeLifecycleAvailability,
  databaseNodeQuickActionAvailability,
} from "./database-node.availability";
export {
  DatabaseConnectionRow,
  type DatabaseConnectionRowProps,
  type DatabaseConnectionRowVariant,
} from "./database-node.connection-row";
export { MASKED_SECRET_VALUE } from "./database-node.mask";
export {
  canCopyDatabaseNodeConnection,
  getDatabaseNodeConnectionKey,
} from "./database-node.root";
export {
  resolveDatabaseNodeStatus,
  resolveDatabaseNodeVisualTone,
} from "./database-node.status";
export type {
  DatabaseEngineKey,
  DatabaseNodeAction,
  DatabaseNodeActions,
  DatabaseNodeConnection,
  DatabaseNodeConnectionKey,
  DatabaseNodeContextValue,
  DatabaseNodeCopyConnectionHandler,
  DatabaseNodeLifecycleActionKey,
  DatabaseNodeLifecycleActions,
  DatabaseNodeMeta,
  DatabaseNodeMetricKey,
  DatabaseNodeMetricValue,
  DatabaseNodePrivateConnection,
  DatabaseNodeProviderProps,
  DatabaseNodePublicConnection,
  DatabaseNodeQuickActionKey,
  DatabaseNodeQuickActions,
  DatabaseNodeRevealConnectionHandler,
  DatabaseNodeRevealedConnection,
  DatabaseNodeRootProps,
  DatabaseNodeState,
  DatabaseNodeStates,
  DatabaseNodeStatus,
  DatabaseNodeStatusTone,
  DatabaseNodeTogglePublicConnectionHandler,
} from "./database-node.types";

export const DatabaseNode = {
  ActionBar: DatabaseNodeActionBar,
  BodyContent: DatabaseNodeBodyContent,
  ConnectionList: DatabaseNodeConnectionList,
  ConnectionRow: DatabaseNodeConnectionRow,
  Content: DatabaseNodeContent,
  DeletionDelayHint: DatabaseNodeDeletionDelayHint,
  FooterContent: DatabaseNodeFooterContent,
  HeaderContent: DatabaseNodeHeaderContent,
  MetricsContent: DatabaseNodeMetricsContent,
  Root: DatabaseNodeRoot,
} as const;

const dn = (component: object, name: string) => {
  (component as { displayName?: string }).displayName = name;
};

dn(DatabaseNodeRoot, "DatabaseNode.Root");
dn(DatabaseNodeContent, "DatabaseNode.Content");
dn(DatabaseNodeDeletionDelayHint, "DatabaseNode.DeletionDelayHint");
dn(DatabaseNodeHeaderContent, "DatabaseNode.HeaderContent");
dn(DatabaseNodeBodyContent, "DatabaseNode.BodyContent");
dn(DatabaseNodeConnectionList, "DatabaseNode.ConnectionList");
dn(DatabaseNodeConnectionRow, "DatabaseNode.ConnectionRow");
dn(DatabaseNodeActionBar, "DatabaseNode.ActionBar");
dn(DatabaseNodeFooterContent, "DatabaseNode.FooterContent");
dn(DatabaseNodeMetricsContent, "DatabaseNode.MetricsContent");
