import type { ReactNode } from "react";

export type CanvasNodeVisualStatusTone =
  | "negative"
  | "neutral"
  | "positive"
  | "progress"
  | "warning";

export interface CanvasNodeStatus {
  label: string;
  visualTone?: CanvasNodeVisualStatusTone;
}

export interface CanvasNodeInteractionState {
  connectable?: boolean;
  dragging?: boolean;
  highlightedConnectionSide?: CanvasNodeConnectionSide;
  selected?: boolean;
}

/** Visual side identifier used for connection handle placement and card-edge hover glow. */
export type CanvasNodeConnectionSide = "bottom" | "left" | "right" | "top";

export interface CanvasNodeState {
  interaction?: CanvasNodeInteractionState;
}

export interface CanvasNodeActions {
  collapse?: () => void;
  expand?: () => void;
}

export interface CanvasNodeMeta {
  expanded: boolean;
}

export interface CanvasNodeContextValue {
  actions: Required<Pick<CanvasNodeActions, "collapse" | "expand">> &
    Omit<CanvasNodeActions, "collapse" | "expand">;
  meta: CanvasNodeMeta;
  state: CanvasNodeState;
}

export interface CanvasNodeProviderProps {
  children?: ReactNode;
  value: CanvasNodeContextValue;
}

export interface CanvasNodeRootProps {
  children?: ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  interaction?: CanvasNodeInteractionState;
  onExpandedChange?: (expanded: boolean) => void;
}
