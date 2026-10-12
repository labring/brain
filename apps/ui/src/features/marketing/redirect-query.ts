export type MarketingRedirectQuery = Record<
  string,
  string | string[] | undefined
>;

/** Carry attribution across server redirects without forwarding credentials. */
export function appendMarketingRedirectQuery(
  path: string,
  query: MarketingRedirectQuery
): string {
  const url = new URL(path, "https://brain.invalid");
  for (const key of ["sea_attr", "consent_token"]) {
    const value = query[key];
    if (typeof value === "string" && value.trim() !== "") {
      url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
