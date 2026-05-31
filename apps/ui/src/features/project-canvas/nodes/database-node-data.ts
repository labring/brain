import type { Node } from "@xyflow/react";

import { CANVAS_DATABASE_NODE_TYPE } from "./constants";
import type { CanvasDatabaseNodeData } from "./types";

export function databaseNodeDataFromNode(
  node: Node | null
): CanvasDatabaseNodeData | null {
  if (node?.type !== CANVAS_DATABASE_NODE_TYPE) {
    return null;
  }
  return node.data as CanvasDatabaseNodeData;
}
