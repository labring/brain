import type {
  DatabaseNodeActions,
  DatabaseNodeConnection,
  DatabaseNodeStates,
} from "@workspace/ui/components/database-node/database-node";

export interface DbSettingsNodeLayoutState {
  expanded?: boolean;
  generatedPosition?: { x: number; y: number };
  positionSource?: "generated";
}

export interface DbSettingsAccess {
  readOnly?: boolean;
}

export interface DbSettingsWorkloadRef {
  name: string;
  namespace: string;
}

export interface DbSettingsData extends Record<string, unknown> {
  actions?: DatabaseNodeActions;
  backupPolicy?: {
    cronExpression?: string;
    enabled?: boolean;
    retentionPeriod?: string;
  };
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
  layout?: DbSettingsNodeLayoutState;
  metadata?: {
    labels?: Record<string, unknown>;
  };
  settingsAccess?: DbSettingsAccess;
  states: DatabaseNodeStates;
  uid?: string;
  workload: DbSettingsWorkloadRef;
}
