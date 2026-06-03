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
  projectUid,
}: {
  node: Node;
  onClose: () => void;
  projectUid: string;
}) {
  const data = databaseNodeDataFromNode(node);
  const name = data?.workload.name?.trim() ?? "";
  const namespace = data?.workload.namespace?.trim() ?? "";

  const descriptor = useMemo<ExecTerminalDescriptor>(
    () => ({
      kind: "db",
      name,
      namespace,
      projectUid,
      title: name || "Terminal",
    }),
    [name, namespace, projectUid]
  );

  return <ExecTerminalPane descriptor={descriptor} onClose={onClose} />;
});

DatabaseTerminalPane.displayName = "DatabaseTerminalPane";
