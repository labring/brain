"use client";

import type { Node } from "@xyflow/react";
import { memo, useMemo } from "react";

import { databaseNodeDataFromNode } from "@/features/project-canvas/nodes/database-node-data";
import {
  type ExecTerminalDescriptor,
  ExecTerminalPane,
} from "./exec-terminal-pane";

export const DatabaseTerminalPane = memo(function DatabaseTerminalPane({
  node,
  onClose,
  projectId,
}: {
  node: Node;
  onClose: () => void;
  projectId: string;
}) {
  const data = databaseNodeDataFromNode(node);
  const displayEngine = data?.states.displayEngine?.trim() ?? "";
  const name = data?.workload.name?.trim() ?? "";
  const namespace = data?.workload.namespace?.trim() ?? "";

  const descriptor = useMemo<ExecTerminalDescriptor>(
    () => ({
      kind: "db",
      name,
      namespace,
      projectId,
      subtitle: displayEngine
        ? `${displayEngine} terminal`
        : "Database terminal",
      title: name || "Database terminal",
    }),
    [displayEngine, name, namespace, projectId]
  );

  return <ExecTerminalPane descriptor={descriptor} onClose={onClose} />;
});

DatabaseTerminalPane.displayName = "DatabaseTerminalPane";
