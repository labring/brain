"use client";

import type { Node } from "@xyflow/react";
import { memo, useMemo } from "react";

import { databaseNodeDataFromNode } from "@/lib/project-canvas/nodes/database-node-data";
import {
  type ExecTerminalDescriptor,
  ExecTerminalPane,
} from "./exec-terminal-pane";

export const DatabaseConsolePane = memo(function DatabaseConsolePane({
  node,
  onClose,
  projectUid,
}: {
  node: Node;
  onClose: () => void;
  projectUid: string;
}) {
  const data = databaseNodeDataFromNode(node);
  const name = data?.workload.name?.trim() ?? "";
  const namespace = data?.workload.namespace?.trim() ?? "";
  const displayEngine = data?.states.displayEngine?.trim() ?? "";

  const descriptor = useMemo<ExecTerminalDescriptor>(
    () => ({
      kind: "db",
      name,
      namespace,
      projectUid,
      subtitle: displayEngine ? `${displayEngine} console` : "Database console",
      title: name || "Database console",
    }),
    [displayEngine, name, namespace, projectUid]
  );

  return <ExecTerminalPane descriptor={descriptor} onClose={onClose} />;
});

DatabaseConsolePane.displayName = "DatabaseConsolePane";
