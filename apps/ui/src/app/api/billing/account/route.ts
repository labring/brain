import { requestAccountService } from "@/lib/account-service/client";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";
import { createBillingAccountHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createBillingAccountHandler({
  authorizeWorkspaceActor,
  requestAccountService,
});
