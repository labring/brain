import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";
import { withBillingDevMock } from "@/features/billing/server/create-billing-route";
import { createBillingWorkspaceCreateRetryPaymentHandler } from "@/features/billing/server/workspace-creation-handlers";
import { requestAccountService } from "@/lib/account-service/client";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withBillingDevMock(
  BILLING_ROUTES.workspaceCreateRetryPayment,
  createBillingWorkspaceCreateRetryPaymentHandler({
    authorizeWorkspaceActor,
    requestAccountService,
  })
);
