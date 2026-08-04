import type {
  CanvasNodeInteractionState,
  CanvasNodeVisualStatusTone,
} from "@workspace/ui/components/canvas-node/canvas-node";
import type { ReactNode } from "react";

export type DatabaseEngineKey =
  | "mongodb"
  | "mysql"
  | "postgresql"
  | "redis"
  | (string & {});

export type DatabaseNodeMetricKey = "cpu" | "memory" | "storage";

export type DatabaseNodeMetricValue = number | string;

export type DatabaseNodeStatusTone =
  | "available"
  | "binding"
  | "bound"
  | "complete"
  | "creating"
  | "degraded"
  | "deleting"
  | "error"
  | "failed"
  | "inaccessible"
  | "not-configured"
  | "paused"
  | "pending"
  | "progressing"
  | "ready"
  | "reconciling"
  | "restarting"
  | "running"
  | "shutdown"
  | "starting"
  | "stopped"
  | "stopping"
  | "succeeded"
  | "suspended"
  | "unconfigured"
  | "unavailable"
  | "unhealthy"
  | "unknown"
  | "updating"
  | (string & {});

export interface DatabaseNodeStatus {
  label: string;
  tone?: DatabaseNodeStatusTone;
  visualTone?: CanvasNodeVisualStatusTone;
}

export interface DatabaseNodeStates {
  deletionTimestamp?: string;
  displayEngine: string;
  engineKey?: DatabaseEngineKey;
  formattedVersion?: string;
  iconUrl?: string;
  metricCapacities?: Partial<Record<DatabaseNodeMetricKey, string>>;
  metrics?: Partial<Record<DatabaseNodeMetricKey, DatabaseNodeMetricValue>>;
  mountPath?: string;
  name: string;
  status?: DatabaseNodeStatus;
}

interface DatabaseNodeConnectionBase {
  displayValue?: string;
  id?: string;
  label: string;
  value?: string;
}

export interface DatabaseNodePrivateConnection
  extends DatabaseNodeConnectionBase {
  kind: "private";
  unavailableMessage?: string;
}

export interface DatabaseNodePublicConnection
  extends DatabaseNodeConnectionBase {
  kind: "public";
  provisioningMessage?: string;
  publicAccess: {
    enabled: boolean;
    loading?: boolean;
  };
}

export type DatabaseNodeConnection =
  | DatabaseNodePrivateConnection
  | DatabaseNodePublicConnection;

export type DatabaseNodeConnectionKey = string;

export type DatabaseNodeCopyConnectionHandler = (
  connection: DatabaseNodeConnection,
  index: number,
  /** The row's on-screen value while its reveal is active — copy reuses it instead of fetching (ADR-0055). */
  activeRevealValue?: string
) => Promise<void> | void;

export type DatabaseNodeRevealConnectionHandler = (
  connection: DatabaseNodeConnection,
  index: number
) => Promise<void> | void;

/** The single revealed connection row (ADR-0055: one at a time). */
export interface DatabaseNodeRevealedConnection {
  key: DatabaseNodeConnectionKey;
  value: string;
}

export type DatabaseNodeTogglePublicConnectionHandler = (
  connection: DatabaseNodePublicConnection,
  index: number,
  nextEnabled: boolean
) => Promise<void> | void;

export type DatabaseNodeQuickActionKey =
  | "dbAccess"
  | "logs"
  | "metrics"
  | "terminal";

export type DatabaseNodeLifecycleActionKey =
  | "delete"
  | "restart"
  | "start"
  | "stop";

export interface DatabaseNodeAction {
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  onClick?: () => Promise<void> | void;
}

export type DatabaseNodeQuickActions = Partial<
  Record<DatabaseNodeQuickActionKey, DatabaseNodeAction>
>;

export type DatabaseNodeLifecycleActions = Partial<
  Record<DatabaseNodeLifecycleActionKey, DatabaseNodeAction>
>;

export interface DatabaseNodeActions {
  copyConnection?: DatabaseNodeCopyConnectionHandler;
  lifecycleActions?: DatabaseNodeLifecycleActions;
  quickActions?: DatabaseNodeQuickActions;
  /** Toggles the reveal of one connection row; absent when no resolver backs the canvas. */
  revealConnection?: DatabaseNodeRevealConnectionHandler;
  togglePublicConnection?: DatabaseNodeTogglePublicConnectionHandler;
  /** User-facing reason shown when the public access toggle is unavailable. */
  togglePublicConnectionDisabledReason?: string;
}

export interface DatabaseNodeMeta {
  copiedFeedbackMs?: number;
}

export interface DatabaseNodeState {
  connections?: DatabaseNodeConnection[];
  copiedConnectionKey?: DatabaseNodeConnectionKey | null;
  revealedConnection?: DatabaseNodeRevealedConnection | null;
  states: DatabaseNodeStates;
}

export interface DatabaseNodeContextValue {
  actions: DatabaseNodeActions;
  meta: DatabaseNodeMeta;
  state: DatabaseNodeState;
}

export interface DatabaseNodeProviderProps {
  children?: ReactNode;
  value: DatabaseNodeContextValue;
}

export interface DatabaseNodeRootProps {
  children?: ReactNode;
  connections?: DatabaseNodeConnection[];
  copiedConnectionKey?: DatabaseNodeConnectionKey | null;
  copiedFeedbackMs?: number;
  defaultExpanded?: boolean;
  expanded?: boolean;
  interaction?: CanvasNodeInteractionState;
  lifecycleActions?: DatabaseNodeLifecycleActions;
  onCopyConnection?: DatabaseNodeCopyConnectionHandler;
  onExpandedChange?: (expanded: boolean) => void;
  onRevealConnection?: DatabaseNodeRevealConnectionHandler;
  onTogglePublicConnection?: DatabaseNodeTogglePublicConnectionHandler;
  quickActions?: DatabaseNodeQuickActions;
  revealedConnection?: DatabaseNodeRevealedConnection | null;
  states: DatabaseNodeStates;
  togglePublicConnectionDisabledReason?: string;
}
