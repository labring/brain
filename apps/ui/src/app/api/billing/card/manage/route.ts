import { requestAccountService } from "@/lib/account-service/client";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";
import { createBillingCardManageHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createBillingCardManageHandler({
  authorizeWorkspaceActor,
  requestAccountService,
});
