import { billingWorkspaceRequestSchema } from "@/features/billing/billing-request-schemas";
import {
  type BillingProxyDependencies,
  BillingProxyRequestError,
  createAuthorizedBillingProxy,
} from "@/features/billing/server/authorized-proxy";
import { decodeKubeconfig } from "@/lib/kubeconfig";
import { routingDomainFromKubeconfig } from "@/lib/kubeconfig-routing-domain";

function addBrainReturnUrl(
  data: unknown,
  context: { encodedKubeconfig: string; verifiedWorkspace: string }
) {
  const cardRequest = billingWorkspaceRequestSchema.parse(data);
  const kubeconfig = decodeKubeconfig(context.encodedKubeconfig);
  const desktopDomain = routingDomainFromKubeconfig(kubeconfig ?? "");
  if (desktopDomain === "") {
    throw new BillingProxyRequestError(
      "Billing desktop origin is unavailable."
    );
  }

  const redirectUrl = new URL(`https://${desktopDomain}/`);
  redirectUrl.searchParams.set("openapp", "system-brain?/billing");

  return {
    ...cardRequest,
    redirectUrl: redirectUrl.toString(),
    workspace: context.verifiedWorkspace,
  };
}

export function createBillingCardManageHandler(
  dependencies: BillingProxyDependencies
) {
  return createAuthorizedBillingProxy(dependencies, {
    invalidRequestMessage: "Invalid card management request.",
    mapRequestBody: addBrainReturnUrl,
    pathname: "/account/v1alpha1/workspace-subscription/card-manage",
    requestSchema: billingWorkspaceRequestSchema,
  });
}
