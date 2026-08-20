import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";
import { withBillingDevMock } from "@/features/billing/server/create-billing-route";
import { requestAccountService } from "@/lib/account-service/client";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";
import { createBillingCardManageHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withBillingDevMock(
  BILLING_ROUTES.cardManage,
  createBillingCardManageHandler({
    authorizeWorkspaceActor,
    requestAccountService,
  })
);
