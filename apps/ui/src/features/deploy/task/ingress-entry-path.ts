/**
 * Which Ingress path is a product's entry (ADR 0079, amended). The Go AP read
 * model applies the same rule for observed Public Addresses; keep both in step.
 */

const INGRESS_PATH_REGEX_METACHARACTER_RE = /[()[\]|*+^$?]/;
const INGRESS_ASSET_PATH_RE = /\.[A-Za-z0-9]{1,5}$/;
const TRAILING_SLASHES_RE = /\/+$/;

/**
 * Reduces one Ingress rule path to the literal prefix a browser can open. A
 * literal path (`Exact` or `Prefix`) keeps its exact spelling, trailing slash
 * included, since `/admin/` under `pathType: Exact` does not match `/admin`.
 * Regex paths (`/admin(/|$)(.*)`, `/?(.*)`) keep their literal head with the
 * separator before the pattern dropped; a fragment disqualifies the path, and
 * a path that is not rooted contributes nothing.
 */
export function ingressEntryPath(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  let path = raw.trim();
  if (!path.startsWith("/") || path.includes("#")) {
    return null;
  }
  const cut = path.search(INGRESS_PATH_REGEX_METACHARACTER_RE);
  if (cut >= 0) {
    path = path.slice(0, cut);
    if (path.length > 1) {
      path = path.replace(TRAILING_SLASHES_RE, "");
    }
  }
  return path === "" ? "/" : path;
}

/** A path whose last segment carries a short file extension: a static asset routed next to a page, never the page. */
export function isIngressAssetPath(path: string): boolean {
  const last = path.slice(path.lastIndexOf("/") + 1);
  return INGRESS_ASSET_PATH_RE.test(last);
}

/**
 * Picks the one path a rule set offers as the entry. A declared root wins
 * outright. Otherwise asset paths step aside and the remaining path that the
 * most other declared paths extend is the page (`/admin` for `/admin.css`,
 * `/admin.js`, ...); a tie keeps manifest order. Ingress path order carries
 * no routing meaning, so it is only ever the last resort.
 */
export function primaryIngressPath(paths: readonly string[]): string {
  if (paths.length === 0 || paths.includes("/")) {
    return "/";
  }
  const pages = paths.filter((path) => !isIngressAssetPath(path));
  const candidates = pages.length > 0 ? pages : paths;
  let best = candidates[0] as string;
  let bestScore = -1;
  for (const candidate of candidates) {
    const score = paths.filter(
      (other) => other !== candidate && other.startsWith(candidate)
    ).length;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
