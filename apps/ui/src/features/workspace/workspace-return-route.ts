import { createAreaReturnRoute } from "@/features/shell/area-return-route";

/**
 * The Workspace Area's return address (spec §D.2): recorded on the Manage
 * Workspaces row of the Workspace Switcher, the area's single entry, and
 * read by the area's close button. A URL-direct entry records nothing, so
 * closing falls back to home.
 */
const workspaceReturnRoute = createAreaReturnRoute({
  prefix: "/workspace",
  storageKey: "workspace-return-route",
});

export function recordWorkspaceReturnRoute(): void {
  workspaceReturnRoute.record();
}

export function readWorkspaceReturnRoute(): string {
  return workspaceReturnRoute.read();
}
