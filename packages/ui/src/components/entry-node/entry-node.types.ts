import type {
  CanvasNodeInteractionState,
  CanvasNodeVisualStatusTone,
} from "@workspace/ui/components/canvas-node/canvas-node";
import type { ReactNode } from "react";

export interface EntryNodeStates {
  /** Human-facing Resource Display Name; falls back to `name` when absent. */
  displayName?: string;
  name: string;
}

export type EntryNodeTargetStatusTone =
  | "accessible"
  | "degraded"
  | "inaccessible"
  | "not-configured"
  | "progressing"
  | "unknown"
  | (string & {});

export interface EntryNodeTargetStatus {
  label: string;
  tone?: EntryNodeTargetStatusTone;
  visualTone?: CanvasNodeVisualStatusTone;
}

/** One Public Address row: the hostname shown, the full URL copied/opened. */
export interface EntryNodeAddress {
  /** Hostname drawn in the row (or a placeholder such as "Pending"). */
  host: string;
  /**
   * Trailing part of `host` drawn de-emphasised — the platform suffix
   * (`.sealos.run`) that every Platform Address shares.
   */
  hostSuffix?: string;
  id?: string;
  status?: EntryNodeTargetStatus;
  /** Full URL for copy and open; absent while the address is pending. */
  value?: string;
}

/** Public Addresses that reach one App Listening Port, headed by its name. */
export interface EntryNodeGroup {
  addresses: EntryNodeAddress[];
  /** Port Display Name; absent ports are headed by their number alone. */
  name?: string;
  port: number;
}

/**
 * What the header's Open control opens: the Default Open Port's best Public
 * Address. `url` absent means the control is drawn disabled with
 * `disabledReason` (or the default "Not accessible yet").
 */
export interface EntryNodeOpenTarget {
  disabledReason?: string;
  /** "Open <Port Display Name>", or "Open" for an unnamed port. */
  label: string;
  url?: string;
}

export type EntryNodeAddressKey = string;

export type EntryNodeCopyAddressHandler = (
  address: EntryNodeAddress,
  key: EntryNodeAddressKey
) => Promise<void> | void;

export interface EntryNodeState {
  copiedAddressKey?: EntryNodeAddressKey | null;
  groups?: EntryNodeGroup[];
  /** Absent when the AP has no Public Address to open. */
  open?: EntryNodeOpenTarget;
  states: EntryNodeStates;
}

export interface EntryNodeActions {
  copyAddress?: EntryNodeCopyAddressHandler;
}

export interface EntryNodeMeta {
  copiedFeedbackMs?: number;
}

export interface EntryNodeContextValue {
  actions: EntryNodeActions;
  meta: EntryNodeMeta;
  state: EntryNodeState;
}

export interface EntryNodeProviderProps {
  children?: ReactNode;
  value: EntryNodeContextValue;
}

export interface EntryNodeRootProps {
  children?: ReactNode;
  copiedAddressKey?: EntryNodeAddressKey | null;
  copiedFeedbackMs?: number;
  defaultExpanded?: boolean;
  expanded?: boolean;
  groups?: EntryNodeGroup[];
  interaction?: CanvasNodeInteractionState;
  onCopyAddress?: EntryNodeCopyAddressHandler;
  onExpandedChange?: (expanded: boolean) => void;
  open?: EntryNodeOpenTarget;
  states: EntryNodeStates;
}
