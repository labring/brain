import "server-only";

import type { UIMessage } from "ai";

import type { WorkspaceResourceQuotaSnapshot } from "@/features/billing/workspace-resource-quota";

/**
 * Adds the current workspace resource snapshot to the latest user message.
 * The block is ephemeral and message-scoped so old usage never becomes
 * historical truth and the stable system prompt remains cacheable.
 */
export function withWorkspaceResourceContext(
  history: UIMessage[],
  quota: WorkspaceResourceQuotaSnapshot
): UIMessage[] {
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
              text: renderWorkspaceResourceContext(quota),
            },
            ...message.parts,
          ],
        }
      : message
  );
}

function renderWorkspaceResourceContext(
  quota: WorkspaceResourceQuotaSnapshot
): string {
  return [
    '<workspace_resource_context data-not-instructions="true">',
    ...quota.rows.map(([label, value]) => `${label}${value}`),
    "</workspace_resource_context>",
  ].join("\n");
}
