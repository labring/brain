"use client";

import {
  CANVAS_NODE_DEFAULT_COPIED_FEEDBACK_MS,
  CanvasNodeCopyFeedbackScope,
} from "@workspace/ui/components/canvas-node/canvas-node.copyable-row";
import { CanvasNodeRoot } from "@workspace/ui/components/canvas-node/canvas-node.root";

import { EntryNodeProvider } from "./entry-node.provider";
import type {
  EntryNodeAddressKey,
  EntryNodeContextValue,
  EntryNodeRootProps,
} from "./entry-node.types";

export function EntryNodeRoot({
  children,
  copiedAddressKey,
  copiedFeedbackMs = CANVAS_NODE_DEFAULT_COPIED_FEEDBACK_MS,
  defaultExpanded,
  expanded,
  groups,
  interaction,
  onCopyAddress,
  onExpandedChange,
  open,
  states,
}: EntryNodeRootProps) {
  return (
    <CanvasNodeRoot
      defaultExpanded={defaultExpanded}
      expanded={expanded}
      interaction={interaction}
      onExpandedChange={onExpandedChange}
    >
      <CanvasNodeCopyFeedbackScope
        copiedFeedbackMs={copiedFeedbackMs}
        copiedKey={copiedAddressKey}
      >
        {({ copiedKey }) => {
          const value: EntryNodeContextValue = {
            actions: {
              copyAddress: onCopyAddress,
            },
            meta: {
              copiedFeedbackMs,
            },
            state: {
              copiedAddressKey: copiedKey as EntryNodeAddressKey | null,
              groups,
              open,
              states,
            },
          };

          return (
            <EntryNodeProvider value={value}>{children}</EntryNodeProvider>
          );
        }}
      </CanvasNodeCopyFeedbackScope>
    </CanvasNodeRoot>
  );
}
