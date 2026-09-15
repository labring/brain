import {
  type AuthorizeWorkspaceActor,
  authorizeBillingActor,
} from "@/features/billing/server/authorized-proxy";
import { BILLING_JUDGMENT_TIMEOUT_MS } from "@/features/billing/server/judgment-budget";
import { workspacePlanNameFromSubscription } from "@/features/billing/workspace-plan-name";
import type { AccountServiceClient } from "@/lib/account-service/client-core";

/**
 * `GET /api/billing/workspace-plans?workspace=…&workspace=…` (spec §C.5):
 * the plan name of each named Workspace's subscription, read one by one
 * from account-service's `workspace-subscription/info` as the verified
 * Workspace Actor (ADR-0060's self-signed JWT). No subscription, a deleted
 * one, or a refused or failed read → null for that row (the Switcher shows
 * PAYG for null); a row never fails the route.
 *
 * Verified against account-service (`authenticateWorkspaceSubscriptionRequest`
 * with `isOwner=false`): any member of a Workspace may read its subscription
 * info, so non-Owner rows carry their real plan name; a Workspace the actor
 * is not a member of answers 401 and lands as null.
 */

const SUBSCRIPTION_INFO_PATHNAME =
  "/account/v1alpha1/workspace-subscription/info";
/**
 * One read per Workspace fans out to account-service; the cap keeps a
 * pathological list from turning one Switcher open into hundreds of
 * upstream calls. Desktop's own Workspace limit sits far below it.
 */
const MAX_WORKSPACES_PER_READ = 50;

export interface WorkspacePlansHandlerDependencies {
  authorizeWorkspaceActor: AuthorizeWorkspaceActor;
  /** The cluster's region domain (`BILLING_LOCAL_REGION_DOMAIN`). */
  regionDomain: () => string;
  requestAccountService: AccountServiceClient;
}

function requestedWorkspaces(request: Request): string[] {
  const workspaces = new URL(request.url).searchParams
    .getAll("workspace")
    .map((workspace) => workspace.trim())
    .filter((workspace) => workspace !== "");
  return [...new Set(workspaces)].slice(0, MAX_WORKSPACES_PER_READ);
}

export function createWorkspacePlansHandler(
  dependencies: WorkspacePlansHandlerDependencies
) {
  return async function handler(request: Request): Promise<Response> {
    const actor = await authorizeBillingActor(
      request,
      dependencies.authorizeWorkspaceActor
    );
    if (!actor.ok) {
      return actor.response;
    }
    const workspaces = requestedWorkspaces(request);
    if (workspaces.length === 0) {
      return Response.json(
        { error: "At least one workspace is required." },
        { status: 400 }
      );
    }
    const regionDomain = dependencies.regionDomain().trim();
    if (regionDomain === "") {
      return Response.json(
        { error: "Billing region is not configured." },
        { status: 503 }
      );
    }
    const signal = AbortSignal.timeout(BILLING_JUDGMENT_TIMEOUT_MS);
    const readPlan = async (workspace: string): Promise<string | null> => {
      try {
        const response = await dependencies.requestAccountService({
          actor: { userId: actor.userId, userUid: actor.userUid },
          init: {
            body: JSON.stringify({ regionDomain, workspace }),
            method: "POST",
            signal,
          },
          pathname: SUBSCRIPTION_INFO_PATHNAME,
        });
        if (!response.ok) {
          await response.body?.cancel();
          return null;
        }
        return workspacePlanNameFromSubscription(await response.json());
      } catch {
        return null;
      }
    };
    const names = await Promise.all(workspaces.map(readPlan));
    const plans: Record<string, string | null> = {};
    workspaces.forEach((workspace, index) => {
      plans[workspace] = names[index] ?? null;
    });
    return Response.json(
      { plans },
      { headers: { "cache-control": "no-store" } }
    );
  };
}
