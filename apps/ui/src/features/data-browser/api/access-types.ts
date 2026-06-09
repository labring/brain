import type { DataBrowserEngine } from "./engine";

export interface AccessObjectRef {
  kind: string;
  path: string[];
}

export interface AccessObject {
  childKinds?: string[];
  displayName?: string;
  hasChildren: boolean;
  kind: string;
  metadata?: Record<string, string>;
  name: string;
  ref: AccessObjectRef;
}

export interface AccessObjectsResult {
  objects: AccessObject[];
  truncated: boolean;
}

export interface AccessObjectResult {
  object: AccessObject;
}

export interface AccessColumn {
  isForeignKey: boolean;
  isPrimary: boolean;
  length?: number;
  name: string;
  precision?: number;
  referencedColumn?: string;
  referencedTable?: string;
  scale?: number;
  type: string;
}

export interface AccessColumnsResult {
  columns: AccessColumn[];
  ref: AccessObjectRef;
}

export interface AccessRowsSort {
  column: string;
  direction: "ASC" | "DESC";
}

export interface AccessRowsResult {
  columns: AccessColumn[];
  pageOffset: number;
  pageSize: number;
  ref: AccessObjectRef;
  rows: string[][];
  totalCount: number;
}

export interface DataFlowTableData {
  columns: string[];
  columnTypes: Record<string, string>;
  disableUpdate: true;
  foreignKeyColumns: string[];
  primaryKey: string | null;
  rows: Array<Record<string, string | null>>;
  total: number;
}

export interface DataBrowserDatabaseMetadata {
  displayEngine: string;
  engineKey?: string;
  formattedVersion?: string;
  name: string;
}

export interface DataBrowserDBServiceBackupSource {
  name: string;
  namespace: string;
  uid?: string;
}

export interface DataBrowserHostContext {
  backups?: unknown[];
  database: DataBrowserDatabaseMetadata;
  databaseWorkloadName: string;
  databaseWorkloadNamespace: string;
  dbService: DataBrowserDBServiceBackupSource;
  engine: DataBrowserEngine;
  kubeconfig: string;
  namespace: string;
  projectId: string;
  refreshProjectCanvas?: () => Promise<unknown>;
}
