"use client";

import {
  CANVAS_NODE_DEFAULT_COPIED_FEEDBACK_MS,
  CanvasNodeCopyFeedbackScope,
} from "@workspace/ui/components/canvas-node/canvas-node.copyable-row";
import { CanvasNodeRoot } from "@workspace/ui/components/canvas-node/canvas-node.root";

import { DatabaseNodeProvider } from "./database-node.provider";
import type {
  DatabaseNodeConnection,
  DatabaseNodeConnectionKey,
  DatabaseNodeContextValue,
  DatabaseNodeRootProps,
} from "./database-node.types";

export function getDatabaseNodeConnectionKey(
  connection: DatabaseNodeConnection,
  index: number
) {
  return connection.id ?? String(index);
}

export function canCopyDatabaseNodeConnection(
  connection: DatabaseNodeConnection
) {
  if (!connection.value) {
    return false;
  }

  if (connection.kind === "public" && !connection.publicAccess.enabled) {
    return false;
  }

  return true;
}

export function DatabaseNodeRoot({
  children,
  connections,
  copiedConnectionKey,
  copiedFeedbackMs = CANVAS_NODE_DEFAULT_COPIED_FEEDBACK_MS,
  defaultExpanded,
  expanded,
  interaction,
  lifecycleActions,
  onCopyConnection,
  onExpandedChange,
  onTogglePublicConnection,
  quickActions,
  states,
  togglePublicConnectionDisabledReason,
}: DatabaseNodeRootProps) {
  return (
    <CanvasNodeRoot
      defaultExpanded={defaultExpanded}
      expanded={expanded}
      interaction={interaction}
      onExpandedChange={onExpandedChange}
    >
      <CanvasNodeCopyFeedbackScope
        copiedFeedbackMs={copiedFeedbackMs}
        copiedKey={copiedConnectionKey}
      >
        {({ copiedKey }) => {
          const value: DatabaseNodeContextValue = {
            actions: {
              copyConnection: onCopyConnection,
              lifecycleActions,
              quickActions,
              togglePublicConnection: onTogglePublicConnection,
              togglePublicConnectionDisabledReason,
            },
            meta: {
              copiedFeedbackMs,
            },
            state: {
              connections,
              copiedConnectionKey:
                copiedKey as DatabaseNodeConnectionKey | null,
              states,
            },
          };

          return (
            <DatabaseNodeProvider value={value}>
              {children}
            </DatabaseNodeProvider>
          );
        }}
      </CanvasNodeCopyFeedbackScope>
    </CanvasNodeRoot>
  );
}
