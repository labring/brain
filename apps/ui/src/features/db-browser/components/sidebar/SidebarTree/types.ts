import type { AccessObjectRef } from "@db-browser/api/access-types";
import type { DbAccessService } from "@db-browser/state/db-access-session";

export type NodeType =
  | "db_service"
  | "database"
  | "schema"
  | "table_folder"
  | "view_folder"
  | "table"
  | "view"
  | "collection"
  | "redis_keys_folder"
  | "redis_key";

export interface TreeNodeData {
  dbServiceKey: string;
  id: string;
  metadata: {
    database?: string;
    schema?: string;
    table?: string;
    redisKeyType?: string;
    objectRef?: AccessObjectRef;
    parentRef?: AccessObjectRef;
    kindFilter?: string[];
    /** True for System Objects; hidden until their Logical Database is revealed. */
    system?: boolean;
  };
  name: string;
  parentId?: string;
  type: NodeType;
}

/** Types that can be expanded to show children */
export const EXPANDABLE_TYPES: ReadonlySet<NodeType> = new Set([
  "db_service",
  "database",
  "schema",
  "table_folder",
  "view_folder",
  "redis_keys_folder",
]);

/** Convert a DB Service to a root-level TreeNodeData. */
export function dbServiceToNode(
  dbService: Pick<DbAccessService, "dbServiceKey" | "displayName">
): TreeNodeData {
  return {
    dbServiceKey: dbService.dbServiceKey,
    id: dbService.dbServiceKey,
    metadata: {},
    name: dbService.displayName,
    type: "db_service",
  };
}
