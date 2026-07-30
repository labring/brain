import BillingUsage from "@/features/billing/billing-usage";
import { getBillingGpuEnabled } from "@/features/billing/config";

export default function BillingUsagePage() {
  return <BillingUsage gpuEnabled={getBillingGpuEnabled()} />;
}
