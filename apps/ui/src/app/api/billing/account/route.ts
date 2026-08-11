import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";
import { withBillingDevMock } from "@/features/billing/server/create-billing-route";
import { requestAccountService } from "@/lib/account-service/client";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";
import { createBillingAccountHandler } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withBillingDevMock(
  BILLING_ROUTES.account,
  createBillingAccountHandler({
    authorizeWorkspaceActor,
    requestAccountService,
  })
);
