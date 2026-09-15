import "server-only";

import {
  type BrainSession,
  SESSION_ERROR_CODES,
  sessionRequestSchema,
} from "../session-schema";
import type { DesktopAuthApi } from "./desktop-auth-api";
import { createDesktopAuthApi } from "./desktop-auth-api";
import {
  createDesktopClient,
  type DesktopFetch,
  desktopApiBaseUrlFromEnv,
} from "./desktop-client";
import { globalTokenFromRequest } from "./login-cookie";
import {
  type EstablishSessionOutcome,
  establishBrainSession,
  type SessionFailure,
} from "./session-service";

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
  establish?: (
    input: { globalToken: string; nsid: string | null },
    desktop: DesktopAuthApi
  ) => Promise<EstablishSessionOutcome>;
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

export function createSessionHandler(
  dependencies: SessionHandlerDependencies = {}
): (request: Request) => Promise<Response> {
  const env = dependencies.env ?? process.env;
  const establish = dependencies.establish ?? establishBrainSession;
  const log: SessionLog =
    dependencies.log ??
    ((message, fields) => console.warn(`[session] ${message}`, fields));

  return async function handler(request: Request): Promise<Response> {
    const payload: unknown =
      request.headers.get("content-length") === "0"
        ? {}
        : await request.json().catch(() => null);
    const parsed = sessionRequestSchema.safeParse(payload ?? {});
    if (!parsed.success) {
      return errorResponse(SESSION_ERROR_CODES.invalidRequest, 400);
    }
    const nsid = parsed.data.nsid?.trim() ?? "";

    const globalToken = globalTokenFromRequest(request, env);
    if (globalToken === "") {
      log("no login cookie on the request", { nsid: nsid !== "" });
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

    const outcome = await establish(
      { globalToken, nsid: nsid === "" ? null : nsid },
      desktop
    );
    if (!outcome.ok) {
      log("establish failed", {
        ...outcome.failure,
        requestedNsid: nsid !== "",
      });
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
