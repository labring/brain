import "server-only";

import {
  GITHUB_APP_INSTALL_COMPLETE_PATH,
  parseInstallReturnPathParam,
} from "./types";

const TRAILING_SLASH_RE = /\/+$/;

function stripTrailingSlash(value: string): string {
  return value.replace(TRAILING_SLASH_RE, "");
}

function envAppUrl(): string | null {
  const raw = process.env.APP_URL?.trim();
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
 *
 * APP_URL, when set, is authoritative — a misconfigured value must surface as
 * a visible redirect mismatch, not be repaired from forgeable request headers.
 * The header-derived origin is the local-development fallback only.
 */
export function getCallbackBaseUrl(request: Request): string {
  return envAppUrl() ?? stripTrailingSlash(originFromRequest(request));
}

export function buildInstallPopupCompleteUrl(
  baseUrl: string,
  storedReturnRaw: string | null | undefined,
  state?: string | null
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
  const stateParam = state?.trim();
  if (stateParam) {
    doneUrl.searchParams.set("state", stateParam);
  }
  return doneUrl.toString();
}
