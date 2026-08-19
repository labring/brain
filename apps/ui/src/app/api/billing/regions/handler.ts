import { z } from "zod";

/**
 * Marks the Current Region in the upstream region catalog (ADR 0063). The
 * catalog's order carries no meaning, so the deployment declares which region
 * it belongs to via BILLING_LOCAL_REGION_DOMAIN (the same deployment-declared
 * fact account-service itself calls LocalRegionDomain) and this route verifies
 * the declaration against the catalog. Resolution failures are hard failures:
 * a wrong Current Region silently prices paid workspaces as PAYG and directs
 * payments at the wrong region, which is worse than an error page.
 */

const regionsPayloadSchema = z.object({
  regions: z.array(z.object({ domain: z.string() }).passthrough()),
});

export const MISSING_LOCAL_REGION_DOMAIN_MESSAGE =
  "Billing region is not configured: set BILLING_LOCAL_REGION_DOMAIN to this cluster's region domain.";
export const INVALID_REGIONS_PAYLOAD_MESSAGE =
  "Billing regions response is invalid.";

export function unknownLocalRegionDomainMessage(domain: string): string {
  return `Billing region "${domain}" is not in the platform's region list.`;
}

type BillingRegionsHandler = (request: Request) => Promise<Response>;

export function resolveCurrentRegionPayload(
  payload: unknown,
  localRegionDomain: string
): { error: string; payload?: never } | { error?: never; payload: object } {
  const domain = localRegionDomain.trim().toLowerCase();
  if (domain === "") {
    return { error: MISSING_LOCAL_REGION_DOMAIN_MESSAGE };
  }
  const parsed = regionsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: INVALID_REGIONS_PAYLOAD_MESSAGE };
  }
  const current = parsed.data.regions.find(
    (region) => region.domain.trim().toLowerCase() === domain
  );
  if (current == null) {
    return { error: unknownLocalRegionDomainMessage(localRegionDomain.trim()) };
  }
  return { payload: { current, regions: parsed.data.regions } };
}

/** Wraps the upstream proxy so successful responses carry `current`. */
export function withCurrentRegion(
  handler: BillingRegionsHandler,
  readLocalRegionDomain: () => string
): BillingRegionsHandler {
  return async (request) => {
    const response = await handler(request);
    if (!response.ok) {
      return response;
    }
    const payload: unknown = await response.json().catch(() => null);
    const resolved = resolveCurrentRegionPayload(
      payload,
      readLocalRegionDomain()
    );
    if (resolved.error != null) {
      return Response.json({ error: resolved.error }, { status: 500 });
    }
    return Response.json(resolved.payload);
  };
}
