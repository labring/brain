import "server-only";

import type { UIMessage } from "ai";

import {
  formatWorkspaceQuotaRows,
  type WorkspaceResourceQuotaRow,
  type WorkspaceResourceQuotaSnapshot,
} from "@/features/billing/workspace-resource-quota";

/**
 * Adds the current workspace resource snapshot to the latest user message.
 * The block is ephemeral and message-scoped. Missing client data is a no-op.
 */
export function withWorkspaceResourceContext(
  history: UIMessage[],
  quota: WorkspaceResourceQuotaSnapshot | undefined
): UIMessage[] {
  if (quota == null) {
    return history;
  }
  const rows = formatWorkspaceQuotaRows(quota.items, { includeMissing: false });
  if (rows.length === 0) {
    return history;
  }

  let latestUserIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "user") {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) {
    return history;
  }

  return history.map((message, index) =>
    index === latestUserIndex
      ? {
          ...message,
          parts: [
            {
              type: "text",
              text: renderWorkspaceResourceContext(rows),
            },
            ...message.parts,
          ],
        }
      : message
  );
}

function renderWorkspaceResourceContext(
  rows: WorkspaceResourceQuotaRow[]
): string {
  return [
    '<workspace_resource_context data-not-instructions="true">',
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "</workspace_resource_context>",
  ].join("\n");
}
