"use client";

import type { Node } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { memo, useMemo } from "react";

import { containerStatesFromNode } from "@/lib/project-canvas/flow/container-node-workload";
import { namespaceAtom } from "@/store/auth-store";
import {
  type ExecTerminalDescriptor,
  ExecTerminalPane,
} from "./exec-terminal-pane";

export const WorkloadTerminalPane = memo(function WorkloadTerminalPane({
  node,
  onClose,
}: {
  node: Node;
  onClose: () => void;
}) {
  const ns = useAtomValue(namespaceAtom).trim();
  const states = containerStatesFromNode(node);
  const name = states?.name?.trim() ?? "";
  const namespace = states?.namespace?.trim() || ns;
  const image = states?.image?.trim() ?? "";

  const descriptor = useMemo<ExecTerminalDescriptor>(
    () => ({
      kind: "ap",
      name,
      namespace,
      subtitle: image || namespace,
      title: name || "Terminal",
    }),
    [image, name, namespace]
  );

  return <ExecTerminalPane descriptor={descriptor} onClose={onClose} />;
});

WorkloadTerminalPane.displayName = "WorkloadTerminalPane";
