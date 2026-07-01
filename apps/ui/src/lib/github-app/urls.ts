import "server-only";

import {
  GITHUB_APP_INSTALL_COMPLETE_PATH,
  parseInstallReturnPathParam,
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
 * Canonical app origin for the GitHub App install round-trip.
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

export function buildInstallPopupCompleteUrl(
  baseUrl: string,
  storedReturnRaw: string | null | undefined
): string {
  const doneUrl = new URL(
    GITHUB_APP_INSTALL_COMPLETE_PATH,
    `${stripTrailingSlash(baseUrl)}/`
  );
  const returnPath = storedReturnRaw
    ? parseInstallReturnPathParam(storedReturnRaw)
    : null;
  if (returnPath) {
    doneUrl.searchParams.set("next", returnPath);
  }
  return doneUrl.toString();
}
