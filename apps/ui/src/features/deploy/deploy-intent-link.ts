import {
  DEPLOY_INTENT_QUERY_KEY,
  type DeployIntentContext,
  deployIntentEnvelopeSchema,
} from "@/features/chat/persistence/deploy-intent-context";

/**
 * Entry-URL link builder + payload contract for deployment intents.
 *
 * External producers (the Template site, GitHub one-click deploy, blogs, and
 * solution pages) land users in Brain with:
 *
 *   ?openapp=system-brain&side=<encoded-side>&intent=<encoded-json>
 *
 * where `side` keeps the existing UI navigation behavior (Template/GitHub
 * panes) and `intent` carries Agent context. The launcher is expected to pass
 * both query params through to the Brain iframe (the accepted fragile
 * assumption); Brain consumes `intent` exactly once from its own location and
 * drops it with `history.replaceState`, so a refresh never re-sends it.
 *
 * Payload contract (version 1):
 * - template: `{ version:1, kind:"template", source?:string, payload:{ templateName, args?:Record<string,string> } }`
 *   `templateName` must be a canonical catalog name; `args` is a whitelist of
 *   catalog-declared, non-sensitive inputs (secrets are never accepted).
 * - github:   `{ version:1, kind:"github", source?:string, payload:{ repo:{ fullName, name, url, id? }, branch? } }`
 *   `url` must be a legal HTTPS github.com URL and `fullName` must match it.
 * - topic:    `{ version:1, kind:"topic", source?:string, payload:{ query, ref? } }`
 *   `query` is bounded free text (no full blog posts; use `ref` for a
 *   reference); the Agent disambiguates it via the template catalog.
 *
 * The server re-validates every incoming intent fail-closed regardless of who
 * produced it; anything invalid is dropped without blocking normal chat.
 */

/** Serialize an intent into the `intent` query value (encoded JSON). */
export function encodeDeployIntentQuery(intent: DeployIntentContext): string {
  return encodeURIComponent(JSON.stringify(intent));
}

/** Parse + structurally validate the `intent` query value; `null` when invalid. */
export function decodeDeployIntentQuery(
  value: string | null | undefined
): DeployIntentContext | null {
  if (value == null || value === "") {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
  const parsed = deployIntentEnvelopeSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Read the raw `intent` query param from a search string (e.g. location.search). */
export function readDeployIntentParam(search: string): string | null {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  );
  return params.get(DEPLOY_INTENT_QUERY_KEY);
}

/**
 * Build the Brain entry query string: `intent=...` plus an optional existing
 * `side` value. Producers composing their own URL should use this shape.
 */
export function buildDeployIntentQuery(
  intent: DeployIntentContext,
  side: string | null | undefined = null
): string {
  const params = new URLSearchParams();
  params.set(DEPLOY_INTENT_QUERY_KEY, encodeDeployIntentQuery(intent));
  if (side != null && side !== "") {
    params.set("side", side);
  }
  return params.toString();
}

/** Parse a Brain entry search string into `{ side, intent }` (intent validated). */
export function parseDeployIntentSearch(search: string): {
  intent: DeployIntentContext | null;
  side: string | null;
} {
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search
  );
  return {
    intent: decodeDeployIntentQuery(params.get(DEPLOY_INTENT_QUERY_KEY)),
    side: params.get("side"),
  };
}

/**
 * Remove the `intent` param from the current URL in place (`history.replaceState`),
 * leaving `side` and everything else untouched. Called exactly once per intent
 * so a refresh cannot re-send it.
 */
export function clearDeployIntentParam(): void {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  if (!url.searchParams.has(DEPLOY_INTENT_QUERY_KEY)) {
    return;
  }
  url.searchParams.delete(DEPLOY_INTENT_QUERY_KEY);
  window.history.replaceState(window.history.state, "", url.toString());
}

const GITHUB_URL_PROTOCOL_RE = /^https:$/i;
const GITHUB_GIT_SUFFIX_RE = /\.git$/i;

/**
 * Normalize a GitHub repository URL into `{ fullName, name }` or `null`.
 *
 * Fail-closed contract shared by the link builder and the server validator: a
 * legal URL is HTTPS, on github.com, and its path is exactly `owner/repo`
 * (optionally `owner/repo.git`). Everything else is rejected.
 */
export function parseGithubRepoUrl(
  url: string
): { fullName: string; name: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!GITHUB_URL_PROTOCOL_RE.test(parsed.protocol)) {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    return null;
  }
  const segments = parsed.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
  if (segments.length !== 2) {
    return null;
  }
  const owner = segments[0]?.replace(GITHUB_GIT_SUFFIX_RE, "");
  const repo = segments[1]?.replace(GITHUB_GIT_SUFFIX_RE, "");
  if (owner == null || owner === "" || repo == null || repo === "") {
    return null;
  }
  return { fullName: `${owner}/${repo}`, name: repo };
}
