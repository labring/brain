import BillingPricing from "@/features/billing/billing-pricing";
import {
  getBillingCurrency,
  getBillingGpuEnabled,
} from "@/features/billing/config";

export default function BillingPricingPage() {
  return (
    <BillingPricing
      currency={getBillingCurrency()}
      gpuEnabled={getBillingGpuEnabled()}
    />
  );
}
