import { BILLING_ROUTES } from "@/features/billing/server/billing-route-table";
import { createBillingRoute } from "@/features/billing/server/create-billing-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = createBillingRoute(BILLING_ROUTES.properties);
