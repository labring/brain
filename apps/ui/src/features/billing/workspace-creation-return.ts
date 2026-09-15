/**
 * What tells a Workspace Creation's Stripe return from a plan change's:
 * Desktop's callback lands both on the same `/billing?stripeState=success`
 * (spec §G.5), so before handing the top window to Stripe the page records
 * which Workspace it is creating, and the return leg reads and forgets the
 * record. Per tab, like the area return routes: a creation begun in one
 * tab never rewords another's conclusion. Storage that is unavailable
 * makes the return read as a plan change — a wording, never a lost payment.
 */

const STORAGE_KEY = "billing-workspace-creation";

export function recordPendingWorkspaceCreation(workspaceId: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, workspaceId);
  } catch {
    // See above: the conclusion reads as a plan change instead.
  }
}

/** Whether `workspaceId` is the Workspace this tab was creating; forgets the record either way. */
export function consumePendingWorkspaceCreation(workspaceId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const recorded = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return recorded != null && recorded === workspaceId;
  } catch {
    return false;
  }
}
