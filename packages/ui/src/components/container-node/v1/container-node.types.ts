import type { CrossplaneServiceStatusPhase } from "@workspace/crossplane/lib/status";

/** Service phase; aligns with Crossplane/Kubernetes-style statuses and status colors. */
export type ContainerNodeStatusTone = CrossplaneServiceStatusPhase;

/** Aggregated node data for canvas/graph payloads; compose v1 UI with explicit per-field props. */
export interface ContainerNodeStates {
  cpuPercent?: number;
  image: string;
  kind?: string;
  memoryPercent?: number;
  name: string;
  /**
   * Kubernetes `metadata.namespace` (or list query fallback) for **AP** lifecycle
   * API calls; omit when unknown or for non-cluster nodes.
   */
  namespace?: string;
  replicas?: number;
  status?: {
    label: string;
    tone: ContainerNodeStatusTone;
  };
  /**
   * Kubernetes `metadata.uid` when this payload was built from a live
   * resource; stable across renames. Omit for static / storybook-only nodes.
   */
  uid?: string;
}

/** Optional handlers for host-composed header / toolbar controls. */
export interface ContainerNodeActions {
  onDelete?: () => void;
  onOpenShell?: () => void;
  onPause?: () => void;
  onRestart?: () => void;
  /** Fired from the Scale dialog when the user commits a replica count (pointer release). */
  onScale?: (nextReplicas: number) => void;
  onStart?: () => void;
  /** Icon toolbar (v1): activity / metrics. */
  onViewActivity?: () => void;
  /** Icon toolbar (v1): schedule / events. */
  onViewCalendar?: () => void;
  onViewLogs?: () => void;
}
