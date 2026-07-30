import BillingCosts from "@/features/billing/billing-costs";
import { getBillingCurrency } from "@/features/billing/config";

export default function BillingCostsPage() {
  return <BillingCosts currency={getBillingCurrency()} />;
}
