import BillingPlan, {
  type BillingPlanMode,
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

/** `?mode=upgrade` opens the plan change, `?mode=create` Workspace Creation. */
function billingPlanMode(value: string | null): BillingPlanMode | null {
  return value === "upgrade" || value === "create" ? value : null;
}

export default async function BillingPlanPage({
  searchParams,
}: {
  searchParams: Promise<BillingPageSearchParams>;
}) {
  const query = await searchParams;
  const initialMode = billingPlanMode(firstSearchParam(query.mode));
  const stripeState = firstSearchParam(query.stripeState);
  const payId = firstSearchParam(query.payId);
  const workspaceId = firstSearchParam(query.workspaceId);
  const stripeReturn: BillingStripeReturn | null =
    stripeState === "success" && payId != null && workspaceId != null
      ? { payId, workspaceId }
      : null;
  // A cancelled Checkout still ends the round-trip it belonged to: the page
  // spends a pending Workspace Creation record for that Workspace so a
  // later plan change is never reworded as a creation.
  const stripeCancelWorkspaceId =
    stripeState === "cancel" && workspaceId != null ? workspaceId : null;

  return (
    <BillingPlan
      currency={getBillingCurrency()}
      gpuEnabled={getBillingGpuEnabled()}
      initialMode={initialMode}
      stripeCancelWorkspaceId={stripeCancelWorkspaceId}
      stripeReturn={stripeReturn}
    />
  );
}
