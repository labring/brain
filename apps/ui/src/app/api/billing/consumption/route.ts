import { billingCostRequestSchemas } from "@/features/billing/billing-cost-request-schemas";
import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";
import { createBillingRoute } from "@/features/billing/server/create-billing-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createBillingRoute(BILLING_ROUTES.consumption, {
  requestSchema: billingCostRequestSchemas.consumption,
});
