import "server-only";

import {
  type BrainSession,
  SESSION_ERROR_CODES,
  sessionRequestSchema,
} from "../session-schema";
import { createDesktopAuthApi } from "./desktop-auth-api";
import {
  createDesktopClient,
  type DesktopFetch,
  desktopApiBaseUrlFromEnv,
} from "./desktop-client";
import { globalTokenFromRequest } from "./login-cookie";
import { establishBrainSession, type SessionFailure } from "./session-service";

/**
 * `POST /api/session` (ADR-0083, spec §A): the single entry that establishes
 * the Brain Session for start, reload, and the silent 401 re-exchange. The
 * body carries only an optional `nsid`; the global token comes off the
 * request (login cookie, or `DEV_GLOBAL_TOKEN` in development). Failures map
 * to real HTTP statuses (§A.3) and are logged structurally — kind, step,
 * Desktop code — never with a token value: the response body is the one
 * place credentials travel, and only to the page that asked.
 */

export type SessionLog = (
  message: string,
  fields: Record<string, unknown>
) => void;

export interface SessionHandlerDependencies {
  env?: Record<string, string | undefined>;
  fetchDesktop?: DesktopFetch;
  log?: SessionLog;
}

function errorResponse(code: string, status: number): Response {
  return Response.json(
    { error: code },
    { headers: { "cache-control": "no-store" }, status }
  );
}

/** Spec §A.3: the HTTP status and error code each failure answers with. */
export function sessionFailureResponse(failure: SessionFailure): Response {
  switch (failure.kind) {
    case "unauthorized":
      return errorResponse(SESSION_ERROR_CODES.sessionExpired, 401);
    case "not_inited":
      return errorResponse(SESSION_ERROR_CODES.workspaceNotInited, 409);
    case "timeout":
      return errorResponse(SESSION_ERROR_CODES.desktopTimeout, 504);
    default:
      return errorResponse(SESSION_ERROR_CODES.desktopUnavailable, 502);
  }
}

function sessionResponse(session: BrainSession): Response {
  return Response.json(session, { headers: { "cache-control": "no-store" } });
}

const JSON_CONTENT_TYPE_RE = /^application\/json\b/i;

/** The request body: absent or blank means `{}`; anything else must be JSON. */
async function requestPayload(
  request: Request
): Promise<{ payload: unknown } | { invalid: true }> {
  const text = (await request.text().catch(() => null))?.trim() ?? "";
  if (text === "") {
    return { payload: {} };
  }
  if (!JSON_CONTENT_TYPE_RE.test(request.headers.get("content-type") ?? "")) {
    return { invalid: true };
  }
  try {
    return { payload: JSON.parse(text) };
  } catch {
    return { invalid: true };
  }
}

/**
 * Whether the request's `Origin` names this app. The route is
 * cookie-authenticated and can trigger Desktop's `namespace/switch`, so a
 * sibling page on the shared cloud domain must not reach it: a present
 * `Origin` must match the request's own host (the `Host` header wins over
 * `request.url` behind an ingress that rewrites the internal host). An
 * absent `Origin` — a non-browser client such as the smoke script — still
 * passes the content-type gate below.
 */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get("origin")?.trim() ?? "";
  if (origin === "" || origin === "null") {
    return true;
  }
  const host = request.headers.get("host")?.trim() ?? "";
  try {
    const parsed = new URL(origin);
    if (host !== "" && parsed.host === host) {
      return true;
    }
    return parsed.origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function createSessionHandler(
  dependencies: SessionHandlerDependencies = {}
): (request: Request) => Promise<Response> {
  const env = dependencies.env ?? process.env;
  const log: SessionLog =
    dependencies.log ??
    ((message, fields) => console.warn(`[session] ${message}`, fields));

  return async function handler(request: Request): Promise<Response> {
    if (!originAllowed(request)) {
      log("session request from a foreign origin", {});
      return errorResponse(SESSION_ERROR_CODES.forbidden, 403);
    }
    const body = await requestPayload(request);
    const parsed =
      "invalid" in body
        ? null
        : sessionRequestSchema.safeParse(body.payload ?? {});
    if (parsed == null || !parsed.success) {
      return errorResponse(SESSION_ERROR_CODES.invalidRequest, 400);
    }
    const nsid = parsed.data.nsid?.trim() ?? "";
    const requestedNsid = nsid !== "";

    const globalToken = globalTokenFromRequest(request, env);
    if (globalToken === "") {
      log("no login cookie on the request", { requestedNsid });
      return errorResponse(SESSION_ERROR_CODES.sessionExpired, 401);
    }

    const baseUrl = desktopApiBaseUrlFromEnv(env);
    if (baseUrl == null) {
      log("DESKTOP_API_BASE_URL is not configured", {});
      return errorResponse(SESSION_ERROR_CODES.desktopUnavailable, 502);
    }
    const desktop = createDesktopAuthApi(
      createDesktopClient({ baseUrl, fetch: dependencies.fetchDesktop })
    );

    const outcome = await establishBrainSession(
      { globalToken, nsid: requestedNsid ? nsid : null },
      desktop
    );
    if (!outcome.ok) {
      log("establish failed", { ...outcome.failure, requestedNsid });
      return sessionFailureResponse(outcome.failure);
    }
    if (outcome.session.fallback != null) {
      log("requested workspace not in list; landed in Personal", {
        fallback: outcome.session.fallback,
      });
    }
    return sessionResponse(outcome.session);
  };
}
