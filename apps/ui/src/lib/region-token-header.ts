/**
 * The third credential header (ADR-0083): Workspace-management fetchers send
 * the Desktop regional token bare in this header, and only the
 * Workspace-management routes read it — mirroring `X-Sealos-App-Token`
 * (ADR-0059). Kubernetes requests keep the kubeconfig in `Authorization:
 * Bearer`; personal-resource requests keep the app token in its own header.
 * Client-safe: no verification happens in Brain, Desktop is the verifier.
 */
export const REGION_TOKEN_HEADER = "X-Sealos-Region-Token";

/** Header record for Workspace-management fetchers; empty without a token. */
export function regionTokenRequestHeaders(
  regionalToken: string
): Record<string, string> {
  const token = regionalToken.trim();
  return token === "" ? {} : { [REGION_TOKEN_HEADER]: token };
}

/** Bare regional token from a Workspace-management request, "" when absent. */
export function regionTokenFromRequest(request: Request): string {
  return request.headers.get(REGION_TOKEN_HEADER)?.trim() ?? "";
}
