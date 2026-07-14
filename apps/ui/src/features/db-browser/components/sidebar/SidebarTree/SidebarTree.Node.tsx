import { useDbAccessIsSelected } from "@db-browser/state/db-access-session";
import { DatabaseEngineIcon } from "@workspace/ui/components/database-engine-icon";
import { cn } from "@workspace/ui/lib/utils";
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Database,
  Eye,
  Files,
  Folder,
  Hash,
  ListOrdered,
  ListTree,
  Loader2,
  Table,
  Type,
} from "lucide-react";
import type React from "react";
import { createContext, memo, use } from "react";
import { useSidebarTreeNodeState } from "./SidebarTreeProvider";
import type { NodeType, TreeNodeData } from "./types";
import { EXPANDABLE_TYPES } from "./types";

/** Interaction context passed by Sidebar to each service tree. */
export interface TreeNodeContextValue {
  dbServiceEngineType: string;
  onContextMenu: (e: React.MouseEvent, node: TreeNodeData) => void;
  onItemClick: (node: TreeNodeData) => void;
  onToggle: (node: TreeNodeData) => void;
}

const TreeNodeCtx = createContext<TreeNodeContextValue | null>(null);

export const TreeNodeProvider = TreeNodeCtx.Provider;

function useTreeNodeContext(): TreeNodeContextValue {
  const ctx = use(TreeNodeCtx);
  if (!ctx) {
    throw new Error("TreeNode must be used within TreeNodeProvider");
  }
  return ctx;
}

const NODE_ICONS: Record<
  NodeType,
  React.ComponentType<{ className?: string }>
> = {
  db_service: Database,
  database: Database,
  schema: ListTree,
  table_folder: Folder,
  view_folder: Folder,
  table: Table,
  view: Eye,
  collection: Files,
  redis_keys_folder: Folder,
  redis_key: Type,
};

const REDIS_TYPE_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  string: Type,
  hash: Hash,
  list: ListOrdered,
  set: CircleDot,
  zset: ArrowUpDown,
};

interface TreeNodeProps {
  depth: number;
  node: TreeNodeData;
}

export const TreeNode = memo(function TreeNode({ node, depth }: TreeNodeProps) {
  const {
    children,
    isExpanded,
    isLoading: nodeIsLoading,
  } = useSidebarTreeNodeState(node.id);
  const { dbServiceEngineType, onItemClick, onToggle, onContextMenu } =
    useTreeNodeContext();

  const isExpandable = EXPANDABLE_TYPES.has(node.type);
  const isRoot = depth === 0;
  const isSelected = useDbAccessIsSelected(node.id);

  const Icon =
    node.type === "redis_key" && node.metadata.redisKeyType
      ? (REDIS_TYPE_ICONS[node.metadata.redisKeyType] ?? NODE_ICONS[node.type])
      : NODE_ICONS[node.type];

  return (
    <div>
      <div
        className={cn(
          "group flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
          isSelected
            ? "bg-input font-medium text-foreground"
            : "text-primary hover:bg-input hover:text-foreground"
        )}
        data-qa-database={node.metadata.database}
        data-qa-db-service-key={node.dbServiceKey || node.id}
        data-qa-module="database"
        data-qa-object="sidebar-node"
        data-qa-resource-id={node.id}
        data-qa-resource-type={node.type}
        data-qa-schema={node.metadata.schema}
        data-qa-state={[
          isSelected ? "selected" : "idle",
          isExpandable ? (isExpanded ? "expanded" : "collapsed") : "leaf",
          nodeIsLoading ? "loading" : null,
        ]
          .filter(Boolean)
          .join(" ")}
        data-testid="database.sidebar.tree-node"
        onClick={() => onItemClick(node)}
        onContextMenu={(e) => onContextMenu(e, node)}
      >
        {isExpandable ? (
          <button
            className={cn(
              "rounded p-0.5 transition-colors",
              isSelected
                ? "text-blue-400 hover:bg-input"
                : "text-primary hover:bg-input"
            )}
            data-qa-action={isExpanded ? "collapse" : "expand"}
            data-qa-module="database"
            data-qa-object="sidebar-node"
            data-qa-resource-id={node.id}
            data-qa-resource-type={node.type}
            data-qa-state={
              nodeIsLoading ? "loading" : isExpanded ? "expanded" : "collapsed"
            }
            data-testid="database.sidebar.tree-node-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node);
            }}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 opacity-70" />
            ) : (
              <ChevronRight className="h-4 w-4 opacity-70" />
            )}
          </button>
        ) : (
          <span className="p-0.5">
            <ChevronRight className="h-4 w-4 opacity-0" />
          </span>
        )}

        {isRoot ? (
          <DatabaseEngineIcon
            className={cn(
              "size-4 shrink-0 object-contain",
              isSelected ? "text-blue-400" : "text-primary"
            )}
            engine={dbServiceEngineType}
          />
        ) : (
          <Icon
            className={cn(
              "h-4 w-4 shrink-0",
              isSelected ? "text-blue-400" : "text-primary"
            )}
          />
        )}

        <span className="flex-1 truncate">{node.name}</span>

        {nodeIsLoading && (
          <Loader2
            className="h-3 w-3 animate-spin text-primary"
            data-qa-module="database"
            data-qa-object="sidebar-node"
            data-qa-resource-id={node.id}
            data-qa-resource-type={node.type}
            data-qa-state="loading"
            data-testid="database.sidebar.tree-node-loading"
          />
        )}
      </div>

      {isExpanded && children && children.length > 0 && (
        <div
          className="mt-1 ml-3 space-y-0.5 border-border border-l pl-3"
          data-qa-module="database"
          data-qa-object="sidebar-node-children"
          data-qa-resource-id={node.id}
          data-qa-resource-type={node.type}
          data-qa-state="expanded"
          data-testid="database.sidebar.tree-node-children"
        >
          {children.map((child) => (
            <TreeNode depth={depth + 1} key={child.id} node={child} />
          ))}
        </div>
      )}
    </div>
  );
});
