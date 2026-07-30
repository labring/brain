import { requestAccountService } from "@/lib/account-service/client";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";
import { createBillingSubscriptionPayHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createBillingSubscriptionPayHandler({
  authorizeWorkspaceActor,
  requestAccountService,
});
