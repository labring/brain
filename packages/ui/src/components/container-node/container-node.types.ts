import type {
  CanvasNodeInteractionState,
  CanvasNodeVisualStatusTone,
} from "@workspace/ui/components/canvas-node/canvas-node";
import type { ReactNode } from "react";

export type ContainerNodeMetricKey = "cpu" | "memory";

export type ContainerNodeMetricValue = number | string;

export type ContainerNodeStatusTone =
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

export interface ContainerNodeStatus {
  label: string;
  tone?: ContainerNodeStatusTone;
  visualTone?: CanvasNodeVisualStatusTone;
}

export interface ContainerNodeStates {
  image: string;
  kind?: string;
  metrics?: Partial<Record<ContainerNodeMetricKey, ContainerNodeMetricValue>>;
  name: string;
  namespace?: string;
  /** Ready pods currently serving; leads the replicas metric when present. */
  readyReplicas?: number;
  /** Desired replica count; shown as `ready/desired` context while they differ. */
  replicas?: number;
  status?: ContainerNodeStatus;
  uid?: string;
}

export type ContainerNodeQuickActionKey =
  | "events"
  | "imageVersions"
  | "logs"
  | "metrics"
  | "terminal";

export type ContainerNodeLifecycleActionKey =
  | "delete"
  | "restart"
  | "start"
  | "stop";

export interface ContainerNodeAction {
  disabled?: boolean;
  disabledReason?: string;
  loading?: boolean;
  onClick?: () => Promise<void> | void;
}

export type ContainerNodeQuickActions = Partial<
  Record<ContainerNodeQuickActionKey, ContainerNodeAction>
>;

export type ContainerNodeLifecycleActions = Partial<
  Record<ContainerNodeLifecycleActionKey, ContainerNodeAction>
>;

export interface ContainerNodeActions {
  lifecycleActions?: ContainerNodeLifecycleActions;
  quickActions?: ContainerNodeQuickActions;
}

export interface ContainerNodeState {
  states: ContainerNodeStates;
}

export interface ContainerNodeContextValue {
  actions: ContainerNodeActions;
  state: ContainerNodeState;
}

export interface ContainerNodeProviderProps {
  children?: ReactNode;
  value: ContainerNodeContextValue;
}

export interface ContainerNodeRootProps {
  children?: ReactNode;
  copiedFeedbackMs?: number;
  defaultExpanded?: boolean;
  expanded?: boolean;
  interaction?: CanvasNodeInteractionState;
  lifecycleActions?: ContainerNodeLifecycleActions;
  onExpandedChange?: (expanded: boolean) => void;
  quickActions?: ContainerNodeQuickActions;
  states: ContainerNodeStates;
}
