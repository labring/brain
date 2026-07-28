/**
 * Personal-resource fetchers attach the desktop-minted App Token bare in this
 * header (ADR-0059). Client-safe: the server-side verifier lives in
 * `@/lib/app-token`.
 */
export const APP_TOKEN_HEADER = "X-Sealos-App-Token";

/** Header record for personal-resource fetchers; empty when no token is hydrated. */
export function appTokenRequestHeaders(
  appToken: string
): Record<string, string> {
  const token = appToken.trim();
  return token === "" ? {} : { [APP_TOKEN_HEADER]: token };
}
