import BillingPlan, {
  type BillingStripeReturn,
} from "@/features/billing/billing-plan";
import {
  getBillingCurrency,
  getBillingGpuEnabled,
} from "@/features/billing/config";

type BillingPageSearchParams = Record<string, string | string[] | undefined>;

function firstSearchParam(value: string | string[] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  const normalized = first?.trim();
  return normalized ? normalized : null;
}

export default async function BillingPlanPage({
  searchParams,
}: {
  searchParams: Promise<BillingPageSearchParams>;
}) {
  const query = await searchParams;
  const initialMode =
    firstSearchParam(query.mode) === "upgrade" ? "upgrade" : null;
  const stripeState = firstSearchParam(query.stripeState);
  const payId = firstSearchParam(query.payId);
  const workspaceId = firstSearchParam(query.workspaceId);
  const stripeReturn: BillingStripeReturn | null =
    stripeState === "success" && payId != null && workspaceId != null
      ? { payId, workspaceId }
      : null;

  return (
    <BillingPlan
      currency={getBillingCurrency()}
      gpuEnabled={getBillingGpuEnabled()}
      initialMode={initialMode}
      stripeReturn={stripeReturn}
    />
  );
}
