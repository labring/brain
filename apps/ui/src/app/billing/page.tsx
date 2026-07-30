import BillingPlan from "@/features/billing/billing-plan";
import { getBillingCurrency } from "@/features/billing/config";

export default function BillingPlanPage() {
  return <BillingPlan currency={getBillingCurrency()} />;
}
