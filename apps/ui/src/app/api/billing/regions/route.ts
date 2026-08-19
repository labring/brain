import { createAuthorizedBillingProxy } from "@/features/billing/server/authorized-proxy";
import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";
import { withBillingDevMock } from "@/features/billing/server/create-billing-route";
import { requestAccountService } from "@/lib/account-service/client";
import { authorizeWorkspaceActor } from "@/lib/request-kubeconfig-auth";
import { withCurrentRegion } from "./handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The dev-mock fixture already answers in the marked `{ current, regions }`
// shape, so only the real upstream proxy goes through withCurrentRegion.
export const GET = withBillingDevMock(
  BILLING_ROUTES.regions,
  withCurrentRegion(
    createAuthorizedBillingProxy(
      { authorizeWorkspaceActor, requestAccountService },
      { pathname: BILLING_ROUTES.regions.upstreamPathname }
    ),
    () => process.env.BILLING_LOCAL_REGION_DOMAIN ?? ""
  )
);
