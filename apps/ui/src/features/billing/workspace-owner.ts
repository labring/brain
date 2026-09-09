import { z } from "zod";

/**
 * The Workspace Owner standing (ADR-0082): the two facts the platform's own
 * marks on the workspace Namespace state. Account Debt inside a workspace is
 * the Owner's fact — sealos suspends namespaces by their owner's account and
 * marks them with `debt.sealos/status`; the `user.sealos.io/owner` label
 * names the Owner. Pure: the client route and the server-side standing both
 * derive it here so no seam can name a different account.
 */

export const WORKSPACE_OWNER_LABEL = "user.sealos.io/owner";
export const DEBT_STATUS_ANNOTATION = "debt.sealos/status";

/**
 * The `debt.sealos/status` values under which the platform has pulled the
 * plug (`controllers/pkg/types/debt.go`; the resources monitor and the
 * account service's `isDebtSuspendedNamespaceStatus` treat this set as
 * suspended). `Normal`, `Resume`, and `ResumeCompleted` are good standing.
 */
const DEBT_SUSPENDED_STATUSES: ReadonlySet<string> = new Set([
  "Suspend",
  "SuspendCompleted",
  "TerminateSuspend",
  "TerminateSuspendCompleted",
  "FinalDeletion",
  "FinalDeletionCompleted",
]);

export interface WorkspaceOwnerStanding {
  /**
   * Whether the calling Workspace Actor is the Workspace Owner; null while
   * unknown (namespace unreadable, no owner label, or no verified crName).
   * Only `true` lets the caller's own balance speak for the workspace.
   */
  isOwner: boolean | null;
  /**
   * Whether the platform's own mark says this workspace is suspended for
   * debt — the verdict for every Workspace Actor alike; null while the
   * namespace could not be read.
   */
  platformDebt: boolean | null;
}

export const UNKNOWN_WORKSPACE_OWNER_STANDING: WorkspaceOwnerStanding = {
  isOwner: null,
  platformDebt: null,
};

const namespaceObjectSchema = z.object({
  kind: z.literal("Namespace"),
  metadata: z.object({
    annotations: z.record(z.string(), z.string()).optional(),
    labels: z.record(z.string(), z.string()).optional(),
  }),
});

/**
 * Judges the standing from a Namespace object read with the request
 * kubeconfig and the caller's verified `userCrName`. Anything that is not
 * a Namespace (a failed read, a Status body) leaves both facts unknown;
 * the balance path then stays closed (ADR-0082: never assume the caller is
 * the Owner).
 */
export function workspaceOwnerStandingFromNamespace(
  namespaceObject: unknown,
  actorCrName: string | null
): WorkspaceOwnerStanding {
  const parsed = namespaceObjectSchema.safeParse(namespaceObject);
  if (!parsed.success) {
    return UNKNOWN_WORKSPACE_OWNER_STANDING;
  }
  const owner = parsed.data.metadata.labels?.[WORKSPACE_OWNER_LABEL]?.trim();
  const actor = actorCrName?.trim() ?? "";
  const status =
    parsed.data.metadata.annotations?.[DEBT_STATUS_ANNOTATION]?.trim() ?? "";
  return {
    isOwner:
      owner == null || owner === "" || actor === "" ? null : owner === actor,
    platformDebt: DEBT_SUSPENDED_STATUSES.has(status),
  };
}

const standingSchema = z.object({
  isOwner: z.boolean().nullable(),
  platformDebt: z.boolean().nullable(),
});

/**
 * Reads a standing Brain itself produced — the `/api/billing/workspace-owner`
 * body on the client, the dev-mock fixture on the server. Anything else is
 * unknown.
 */
export function parseWorkspaceOwnerStanding(
  payload: unknown
): WorkspaceOwnerStanding {
  const parsed = standingSchema.safeParse(payload);
  return parsed.success ? parsed.data : UNKNOWN_WORKSPACE_OWNER_STANDING;
}
