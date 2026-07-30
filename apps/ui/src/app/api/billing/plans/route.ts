import { createAuthorizedBillingProxy } from "@/features/billing/server/authorized-proxy";
import { requestAccountService } from "@/lib/account-service/client";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createAuthorizedBillingProxy(
  { authorizeWorkspaceActor, requestAccountService },
  { pathname: "/account/v1alpha1/workspace-subscription/plan-list" }
);
