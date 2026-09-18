/**
 * The `/project/<uid>` guard's judgment (spec §H.2): once the Project list
 * of the current Workspace is loaded and does not contain the Project the
 * URL names — after a Workspace switch landed on a stale deep link, or a
 * link into a Project of another Workspace — the page leaves for the
 * Project list instead of showing an empty canvas. While the list is still
 * loading nothing is judged, so a slow list never bounces a valid Project.
 */
export type ProjectWorkspaceGuardDecision = "leave" | "stay";

export function projectWorkspaceGuardDecision(input: {
  loaded: boolean;
  projectId: string;
  projectIds: readonly string[];
}): ProjectWorkspaceGuardDecision {
  if (!input.loaded || input.projectId === "") {
    return "stay";
  }
  return input.projectIds.includes(input.projectId) ? "stay" : "leave";
}
