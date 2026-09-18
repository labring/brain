/**
 * What tells a Workspace Creation's Stripe return from a plan change's:
 * Desktop's callback lands both on the same `/billing?stripeState=success`
 * (spec §G.5), so before handing the top window to Stripe the page records
 * which Workspace it is creating, and the return leg reads and forgets the
 * record. Per tab, like the area return routes: a creation begun in one
 * tab never rewords another's conclusion. Storage that is unavailable
 * makes the return read as a plan change — a wording, never a lost payment.
 *
 * The record carries the checkout's `payId`: a later plan change for the
 * same Workspace pays under a different one, so an abandoned creation
 * Checkout can never reword that return. Any Stripe return for the
 * recorded Workspace — success or cancel — spends the record; one for a
 * different Workspace leaves it.
 */

const STORAGE_KEY = "billing-workspace-creation";

export interface PendingWorkspaceCreation {
  /** The checkout's pay id, when Desktop's answer carried one. */
  payId: string | null;
  workspaceId: string;
}

function readStored(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function recordPendingWorkspaceCreation(
  workspaceId: string,
  payId: string | null = null
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ payId, workspaceId } satisfies PendingWorkspaceCreation)
    );
  } catch {
    // See above: the conclusion reads as a plan change instead.
  }
}

export function readPendingWorkspaceCreation(): PendingWorkspaceCreation | null {
  const stored = readStored();
  if (stored == null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed === "object" &&
      parsed != null &&
      "workspaceId" in parsed &&
      typeof (parsed as { workspaceId: unknown }).workspaceId === "string"
    ) {
      const record = parsed as { payId?: unknown; workspaceId: string };
      return {
        payId:
          typeof record.payId === "string" && record.payId !== ""
            ? record.payId
            : null,
        workspaceId: record.workspaceId,
      };
    }
  } catch {
    // A legacy plain-string record names the Workspace; its pay id is lost.
    return { payId: null, workspaceId: stored };
  }
  return null;
}

/** Whether `workspaceId` is the Workspace this tab was creating; the record stays. */
export function isPendingWorkspaceCreation(workspaceId: string): boolean {
  return readPendingWorkspaceCreation()?.workspaceId === workspaceId;
}

/**
 * Whether `workspaceId` is the Workspace this tab was creating; forgets the
 * record when it matched. A record for another Workspace stays.
 */
export function consumePendingWorkspaceCreation(workspaceId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const recorded = readPendingWorkspaceCreation();
  if (recorded == null || recorded.workspaceId !== workspaceId) {
    return false;
  }
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // See above: the conclusion reads as a plan change instead.
  }
  return true;
}
