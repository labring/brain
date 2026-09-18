import { WORKSPACE_NAME_MAX_LENGTH } from "@/features/workspace/workspace-write-schema";

/**
 * Workspace Creation's name rules on the client (spec §G.2): the name is
 * trimmed, required, at most 32 characters, and checked against the
 * Workspaces the session already lists — case-insensitively, since
 * Desktop's own check is exact and would let "acme" past "Acme" only to
 * confuse the Switcher. The server repeats none of this beyond the schema;
 * Desktop's 409 remains the authority on duplicates.
 */

export type WorkspaceNameIssue = "duplicate" | "required" | "too-long";

export const WORKSPACE_NAME_ISSUE_MESSAGES: Record<WorkspaceNameIssue, string> =
  {
    duplicate: "A Workspace with this name already exists.",
    required: "Enter a name for the Workspace.",
    "too-long": `Use at most ${WORKSPACE_NAME_MAX_LENGTH} characters.`,
  };

export function workspaceNameIssue(
  name: string,
  existingNames: readonly string[]
): WorkspaceNameIssue | null {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "required";
  }
  if (trimmed.length > WORKSPACE_NAME_MAX_LENGTH) {
    return "too-long";
  }
  const folded = trimmed.toLowerCase();
  if (
    existingNames.some((existing) => existing.trim().toLowerCase() === folded)
  ) {
    return "duplicate";
  }
  return null;
}
