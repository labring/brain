import type { CrossplaneServiceStatusPhase } from "@workspace/crossplane/lib/status";

/** Service phase; aligns with Crossplane/Kubernetes-style statuses and status colors. */
export type ContainerNodeStatusTone = CrossplaneServiceStatusPhase;

/** Display state for a container node (passed into Root as `states`). */
export interface ContainerNodeStates {
  cpuPercent?: number;
  image: string;
  kind?: string;
  memoryPercent?: number;
  name: string;
  replicas?: number;
  status?: {
    label: string;
    tone: ContainerNodeStatusTone;
  };
}

/** Optional handlers wired from the default header menu. */
export interface ContainerNodeActions {
  onDelete?: () => void;
  onOpenShell?: () => void;
  onRestart?: () => void;
  /** Fired from the Scale dialog when the user commits a replica count (pointer release). */
  onScale?: (nextReplicas: number) => void;
  onViewLogs?: () => void;
}

export interface ContainerNodeValue {
  actions: ContainerNodeActions;
  states: ContainerNodeStates;
}
