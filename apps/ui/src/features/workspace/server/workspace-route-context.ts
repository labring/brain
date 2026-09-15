import "server-only";

import {
  createDesktopAuthApi,
  type DesktopAuthApi,
} from "@/features/session/server/desktop-auth-api";
import {
  createDesktopClient,
  type DesktopCallFailure,
  type DesktopFetch,
  desktopApiBaseUrlFromEnv,
} from "@/features/session/server/desktop-client";
import { regionTokenFromRequest } from "@/lib/region-token-header";

import { WORKSPACE_ERROR_CODES } from "../workspace-errors";

/**
 * The preamble and the failure translation every Workspace-management route
 * shares (spec §B.1): read the bare regional token off
 * `X-Sealos-Region-Token` (missing → 401), build the Desktop client from the
 * environment, and map a Desktop failure to a real HTTP status with one of
 * Brain's own error codes. Brain repeats no permission judgment here —
 * Desktop is the sole authority — and logs kinds and codes, never a token.
 */

export type WorkspaceRouteLog = (
  message: string,
  fields: Record<string, unknown>
) => void;

export interface WorkspaceRouteDependencies {
  env?: Record<string, string | undefined>;
  fetchDesktop?: DesktopFetch;
  log?: WorkspaceRouteLog;
}

export function workspaceErrorResponse(code: string, status: number): Response {
  return Response.json(
    { error: code },
    { headers: { "cache-control": "no-store" }, status }
  );
}

export function workspaceJsonResponse(payload: unknown): Response {
  return Response.json(payload, { headers: { "cache-control": "no-store" } });
}

/**
 * The request body as JSON: absent or blank is `{}` (then invalid against
 * every route's schema), unparseable is null.
 */
export async function workspaceRequestPayload(
  request: Request
): Promise<unknown | null> {
  const text = (await request.text().catch(() => null))?.trim() ?? "";
  if (text === "") {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const DESKTOP_CODE_RESPONSES: Record<number, [string, number]> = {
  400: [WORKSPACE_ERROR_CODES.invalidRequest, 400],
  401: [WORKSPACE_ERROR_CODES.sessionExpired, 401],
  403: [WORKSPACE_ERROR_CODES.forbidden, 403],
  404: [WORKSPACE_ERROR_CODES.notFound, 404],
  409: [WORKSPACE_ERROR_CODES.conflict, 409],
};

/** Desktop's envelope code or transport failure → Brain's status and code. */
export function desktopFailureResponse(failure: DesktopCallFailure): Response {
  switch (failure.kind) {
    case "desktop_code": {
      const [code, status] = DESKTOP_CODE_RESPONSES[failure.code] ?? [
        WORKSPACE_ERROR_CODES.desktopError,
        500,
      ];
      return workspaceErrorResponse(code, status);
    }
    case "timeout":
      return workspaceErrorResponse(WORKSPACE_ERROR_CODES.desktopTimeout, 504);
    default:
      return workspaceErrorResponse(
        WORKSPACE_ERROR_CODES.desktopUnavailable,
        502
      );
  }
}

/** What a failure log line carries: kinds and codes, never token values. */
export function desktopFailureLogFields(
  failure: DesktopCallFailure
): Record<string, unknown> {
  switch (failure.kind) {
    case "desktop_code":
      return { code: failure.code, kind: failure.kind };
    case "http":
      return { kind: failure.kind, status: failure.status };
    default:
      return { kind: failure.kind };
  }
}

export type WorkspaceRouteContext =
  | {
      desktop: DesktopAuthApi;
      log: WorkspaceRouteLog;
      ok: true;
      regionalToken: string;
    }
  | { ok: false; response: Response };

export function workspaceRouteContext(
  request: Request,
  dependencies: WorkspaceRouteDependencies,
  routeLabel: string
): WorkspaceRouteContext {
  const env = dependencies.env ?? process.env;
  const log: WorkspaceRouteLog =
    dependencies.log ??
    ((message, fields) => console.warn(`[${routeLabel}] ${message}`, fields));

  const regionalToken = regionTokenFromRequest(request);
  if (regionalToken === "") {
    return {
      ok: false,
      response: workspaceErrorResponse(
        WORKSPACE_ERROR_CODES.regionTokenRequired,
        401
      ),
    };
  }
  const baseUrl = desktopApiBaseUrlFromEnv(env);
  if (baseUrl == null) {
    log("DESKTOP_API_BASE_URL is not configured", {});
    return {
      ok: false,
      response: workspaceErrorResponse(
        WORKSPACE_ERROR_CODES.desktopUnavailable,
        502
      ),
    };
  }
  return {
    desktop: createDesktopAuthApi(
      createDesktopClient({ baseUrl, fetch: dependencies.fetchDesktop })
    ),
    log,
    ok: true,
    regionalToken,
  };
}
