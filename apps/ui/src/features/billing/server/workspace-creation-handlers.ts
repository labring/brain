import "server-only";

import type { z } from "zod";

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
import { desktopFailureLogFields } from "@/features/workspace/server/workspace-route-context";
import { appTokenFromRequest } from "@/lib/app-token";

import {
  type CreatedWorkspace,
  WORKSPACE_NAME_CONFLICT_CODE,
  WORKSPACE_NAME_CONFLICT_MESSAGE,
  type WorkspaceCreationPayment,
  type WorkspaceCreationRequest,
  type WorkspaceCreationRetryRequest,
  workspaceCreationRequestSchema,
  workspaceCreationRetryRequestSchema,
} from "../workspace-creation-schema";
import {
  authorizeBillingActor,
  type BillingProxyDependencies,
} from "./authorized-proxy";
import { BILLING_ROUTES } from "./billing-route-table";

/**
 * Workspace Creation's routes (spec §G.3, §G.7), the costcenter's two steps
 * replayed by Brain: Step 1 asks Desktop for a Team Workspace with the
 * request's app token — raw, the form Desktop's `create` verifies — and
 * Step 2 asks account-service to start the first subscription payment as
 * Brain (`operator: created`, `payApp: system-brain`). A taken name is the
 * one failure the page must tell apart (409); every other Desktop failure
 * is translated without its message text. Once the Workspace exists, a
 * failed Step 2 is an outcome, not an error: the route answers 200 with
 * `payment.status = failed` and the retry route redoes Step 2 alone.
 * Nothing here logs a token.
 */

export type WorkspaceCreationRouteLog = (
  message: string,
  fields: Record<string, unknown>
) => void;

export interface WorkspaceCreationRouteDependencies
  extends BillingProxyDependencies {
  env?: Record<string, string | undefined>;
  fetchDesktop?: DesktopFetch;
  log?: WorkspaceCreationRouteLog;
}

type RouteHandler = (request: Request) => Promise<Response>;

interface PaymentRequestFields {
  cardId?: string;
  payMethod: "balance" | "stripe";
  period: "1m" | "1y";
  planName: string;
  promotionCode?: string;
  regionDomain: string;
}

function errorResponse(error: string, status: number, code?: string): Response {
  return Response.json(code == null ? { error } : { code, error }, {
    headers: { "cache-control": "no-store" },
    status,
  });
}

function jsonResponse(payload: unknown): Response {
  return Response.json(payload, { headers: { "cache-control": "no-store" } });
}

async function parsedBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  invalidMessage: string
): Promise<
  { body: T; response?: never } | { body?: never; response: Response }
> {
  const payload: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  return parsed.success
    ? { body: parsed.data }
    : { response: errorResponse(invalidMessage, 400) };
}

const DESKTOP_CODE_STATUSES: Record<number, number> = {
  400: 400,
  401: 401,
  403: 403,
};

/** Desktop's envelope code or transport failure → Brain's own answer (§B.1). */
function desktopCreateFailureResponse(failure: DesktopCallFailure): Response {
  if (failure.kind === "desktop_code") {
    if (failure.code === 409) {
      return errorResponse(
        WORKSPACE_NAME_CONFLICT_MESSAGE,
        409,
        WORKSPACE_NAME_CONFLICT_CODE
      );
    }
    const status = DESKTOP_CODE_STATUSES[failure.code];
    return status == null
      ? errorResponse("Desktop could not create the Workspace.", 502)
      : errorResponse("Desktop refused to create the Workspace.", status);
  }
  if (failure.kind === "timeout") {
    return errorResponse("Desktop did not answer in time.", 504);
  }
  return errorResponse("Desktop is unavailable.", 502);
}

function upstreamErrorText(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload != null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim() !== ""
  ) {
    return payload.error.trim();
  }
  return fallback;
}

const PAYMENT_FAILED_FALLBACK =
  "The subscription payment could not be started.";

/**
 * Step 2: account-service's pay for the created Workspace. Any refusal —
 * an upstream error status, a non-JSON body, `success: false`, no checkout
 * URL — is a failed payment the page can retry, never a route error.
 */
async function startWorkspacePayment(
  dependencies: WorkspaceCreationRouteDependencies,
  actor: { userId: string; userUid: string },
  workspaceId: string,
  fields: PaymentRequestFields
): Promise<WorkspaceCreationPayment> {
  const body = {
    ...(fields.cardId == null ? {} : { cardId: fields.cardId }),
    operator: "created",
    payApp: "system-brain",
    payMethod: fields.payMethod,
    period: fields.period,
    planName: fields.planName,
    ...(fields.promotionCode == null
      ? {}
      : { promotionCode: fields.promotionCode }),
    regionDomain: fields.regionDomain,
    workspace: workspaceId,
  };
  const response = await dependencies.requestAccountService({
    actor,
    init: { body: JSON.stringify(body), method: "POST" },
    pathname: BILLING_ROUTES.subscriptionPay.upstreamPathname,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    return {
      error: upstreamErrorText(payload, PAYMENT_FAILED_FALLBACK),
      status: "failed",
    };
  }
  const checkout =
    typeof payload === "object" && payload != null
      ? (payload as Record<string, unknown>)
      : {};
  const redirectUrl =
    typeof checkout.redirectUrl === "string" ? checkout.redirectUrl.trim() : "";
  if (checkout.success !== true || redirectUrl === "") {
    return { error: PAYMENT_FAILED_FALLBACK, status: "failed" };
  }
  return {
    invoiceId:
      typeof checkout.invoiceID === "string" ? checkout.invoiceID : null,
    payId: typeof checkout.payID === "string" ? checkout.payID : null,
    redirectUrl,
    status: "started",
  };
}

type DesktopForCreation =
  | { desktop: DesktopAuthApi; ok: true }
  | { ok: false; response: Response };

function desktopForCreation(
  dependencies: WorkspaceCreationRouteDependencies,
  log: WorkspaceCreationRouteLog
): DesktopForCreation {
  const baseUrl = desktopApiBaseUrlFromEnv(dependencies.env ?? process.env);
  if (baseUrl == null) {
    log("DESKTOP_API_BASE_URL is not configured", {});
    return {
      ok: false,
      response: errorResponse("Desktop is unavailable.", 502),
    };
  }
  return {
    desktop: createDesktopAuthApi(
      createDesktopClient({ baseUrl, fetch: dependencies.fetchDesktop })
    ),
    ok: true,
  };
}

function routeLog(
  dependencies: WorkspaceCreationRouteDependencies,
  routeLabel: string
): WorkspaceCreationRouteLog {
  return (
    dependencies.log ??
    ((message, fields) => console.warn(`[${routeLabel}] ${message}`, fields))
  );
}

/** `POST /api/billing/workspace-create`: Step 1 at Desktop, then Step 2. */
export function createBillingWorkspaceCreateHandler(
  dependencies: WorkspaceCreationRouteDependencies
): RouteHandler {
  const entry = BILLING_ROUTES.workspaceCreate;
  return async function handler(request: Request): Promise<Response> {
    const log = routeLog(dependencies, entry.apiPath);
    const actor = await authorizeBillingActor(
      request,
      dependencies.authorizeWorkspaceActor
    );
    if (!actor.ok) {
      return actor.response;
    }
    if (actor.userId === "") {
      return errorResponse("Authentication is required.", 401);
    }
    const parsed = await parsedBody<WorkspaceCreationRequest>(
      request,
      workspaceCreationRequestSchema,
      "Invalid workspace creation request."
    );
    if (parsed.response != null) {
      return parsed.response;
    }
    const desktop = desktopForCreation(dependencies, log);
    if (!desktop.ok) {
      return desktop.response;
    }

    const created = await desktop.desktop.namespaceCreate(
      appTokenFromRequest(request),
      parsed.body.name
    );
    if (!created.ok) {
      log(
        "Desktop workspace creation failed",
        desktopFailureLogFields(created)
      );
      return desktopCreateFailureResponse(created);
    }
    const workspace: CreatedWorkspace = created.data;
    const payment = await startWorkspacePayment(
      dependencies,
      { userId: actor.userId, userUid: actor.userUid },
      workspace.id,
      parsed.body
    );
    if (payment.status === "failed") {
      log("Workspace created but its first payment did not start", {
        workspaceId: workspace.id,
      });
    }
    return jsonResponse({ payment, workspace });
  };
}

/** `POST /api/billing/workspace-create/retry-payment`: Step 2 alone. */
export function createBillingWorkspaceCreateRetryPaymentHandler(
  dependencies: WorkspaceCreationRouteDependencies
): RouteHandler {
  return async function handler(request: Request): Promise<Response> {
    const actor = await authorizeBillingActor(
      request,
      dependencies.authorizeWorkspaceActor
    );
    if (!actor.ok) {
      return actor.response;
    }
    if (actor.userId === "") {
      return errorResponse("Authentication is required.", 401);
    }
    const parsed = await parsedBody<WorkspaceCreationRetryRequest>(
      request,
      workspaceCreationRetryRequestSchema,
      "Invalid workspace payment retry request."
    );
    if (parsed.response != null) {
      return parsed.response;
    }
    const payment = await startWorkspacePayment(
      dependencies,
      { userId: actor.userId, userUid: actor.userUid },
      parsed.body.workspaceId,
      parsed.body
    );
    return jsonResponse({ payment });
  };
}
