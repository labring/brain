"use client";

import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { memo, useMemo } from "react";

import { containerStatesFromNode } from "@/features/project-canvas/flow/container-node-workload";
import { namespaceAtom } from "@/store/auth-store";
import {
  type ExecTerminalDescriptor,
  ExecTerminalPane,
} from "./exec-terminal-pane";

export const WorkloadTerminalPane = memo(function WorkloadTerminalPane({
  node,
  onClose,
  open,
}: {
  node: Node;
  onClose: () => void;
  open?: boolean;
}) {
  const ns = useAtomValue(namespaceAtom).trim();
  const states = containerStatesFromNode(node);
  const name = states?.name?.trim() ?? "";
  const namespace = states?.namespace?.trim() || ns;

  const descriptor = useMemo<ExecTerminalDescriptor>(
    () => ({
      kind: "ap",
      name,
      namespace,
      title: name || "Terminal",
    }),
    [name, namespace]
  );

  return (
    <ExecTerminalPane descriptor={descriptor} onClose={onClose} open={open} />
  );
});

WorkloadTerminalPane.displayName = "WorkloadTerminalPane";
