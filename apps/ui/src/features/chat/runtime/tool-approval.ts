/**
 * Keep this as a per-tool map. In AI SDK 7 a generic approval callback takes
 * precedence over tool-level `needsApproval`, so a catch-all callback would
 * silently bypass the existing Product and Project approval gates.
 */
export const CHAT_TOOL_APPROVAL = {
  bash: "user-approval",
  writeFile: "user-approval",
} as const;
