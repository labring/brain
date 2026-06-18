import "server-only";

import {
  GITHUB_OAUTH_CALLBACK_PATH,
  GITHUB_OAUTH_COMPLETE_PATH,
  parseOAuthReturnPathParam,
} from "./types";

const TRAILING_SLASH_RE = /\/+$/;

function stripTrailingSlash(value: string): string {
  return value.replace(TRAILING_SLASH_RE, "");
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function envPublicAppUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return raw ? stripTrailingSlash(raw) : null;
}

function originFromRequest(request: Request): string {
  const proto = request.headers.get("x-forwarded-proto");
  const host =
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    "localhost:3000";
  return proto ? `${proto}://${host}` : `http://${host}`;
}

/**
 * Canonical app origin for the OAuth round-trip. Prefers `NEXT_PUBLIC_APP_URL`
 * so `redirect_uri` matches the registered GitHub callback, but falls back to
 * the runtime origin when env is loopback and the user opened a non-loopback host.
 */
export function getCallbackBaseUrl(request: Request): string {
  const env = envPublicAppUrl();
  const runtime = stripTrailingSlash(originFromRequest(request));
  if (!env) {
    return runtime;
  }
  const envParsed = tryParseUrl(env);
  const runtimeParsed = tryParseUrl(runtime);
  if (!(envParsed && runtimeParsed)) {
    return env;
  }
  if (
    isLoopbackHostname(envParsed.hostname) &&
    !isLoopbackHostname(runtimeParsed.hostname)
  ) {
    return `${runtimeParsed.protocol}//${runtimeParsed.host}`;
  }
  return env;
}

export function buildCallbackUri(baseUrl: string): string {
  return `${stripTrailingSlash(baseUrl)}${GITHUB_OAUTH_CALLBACK_PATH}`;
}

function envDefaultRedirectUrl(baseUrl: string): string {
  const root = stripTrailingSlash(baseUrl);
  const pathRaw = (process.env.GITHUB_OAUTH_NEXT_PATH ?? "/").trim() || "/";
  const path = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
  const searchRaw = process.env.GITHUB_OAUTH_NEXT_SEARCH?.trim();
  let search = "";
  if (searchRaw) {
    search = searchRaw.startsWith("?") ? searchRaw : `?${searchRaw}`;
  }
  return `${root}${path}${search}`;
}

/** Prefer the cookie-stored relative return path; fall back to env defaults. */
export function buildOAuthSuccessRedirectUrl(
  baseUrl: string,
  storedReturnRaw: string | undefined
): string {
  const returnPath = storedReturnRaw
    ? parseOAuthReturnPathParam(storedReturnRaw)
    : null;
  if (returnPath) {
    return `${stripTrailingSlash(baseUrl)}${returnPath}`;
  }
  return envDefaultRedirectUrl(baseUrl);
}

export function buildOAuthPopupCompleteUrl(
  baseUrl: string,
  storedReturnRaw: string | undefined
): string {
  const doneUrl = new URL(
    GITHUB_OAUTH_COMPLETE_PATH,
    `${stripTrailingSlash(baseUrl)}/`
  );
  const returnPath = storedReturnRaw
    ? parseOAuthReturnPathParam(storedReturnRaw)
    : null;
  if (returnPath) {
    doneUrl.searchParams.set("next", returnPath);
  }
  return doneUrl.toString();
}
