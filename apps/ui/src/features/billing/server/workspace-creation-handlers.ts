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

import { billingPlansResponseSchema } from "../billing-plan-catalog";
import {
  type CreatedWorkspace,
  WORKSPACE_NAME_CONFLICT_CODE,
  WORKSPACE_NAME_CONFLICT_MESSAGE,
  type WorkspaceCreationPayment,
  type WorkspacePaymentTerms,
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

/** The account-service actor a Billing write runs as. */
interface PayingActor {
  userId: string;
  userUid: string;
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

/**
 * The preamble both routes share: the Workspace Actor proven the way every
 * Billing write proves it (a missing binding or legacy id → 401), then the
 * route's zod body (→ 400). account-service still addresses the actor by
 * the legacy id as well.
 */
async function authorizedCreationRequest<T>(
  request: Request,
  dependencies: WorkspaceCreationRouteDependencies,
  schema: z.ZodType<T>,
  invalidMessage: string
): Promise<
  | { actor: PayingActor; body: T; response?: never }
  | { actor?: never; body?: never; response: Response }
> {
  const actor = await authorizeBillingActor(
    request,
    dependencies.authorizeWorkspaceActor
  );
  if (!actor.ok) {
    return { response: actor.response };
  }
  if (actor.userId === "") {
    return { response: errorResponse("Authentication is required.", 401) };
  }
  const payload: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { response: errorResponse(invalidMessage, 400) };
  }
  return {
    actor: { userId: actor.userId, userUid: actor.userUid },
    body: parsed.data,
  };
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
 * The priced plan names account-service's catalog answers with: creation
 * always chooses a priced plan (spec §G.2), and the picker's list is not
 * authority — a crafted POST naming "Free" must be refused before Desktop
 * creates anything. Null when the catalog could not be read: creation then
 * fails closed rather than create a Workspace it cannot bill.
 */
async function pricedPlanNames(
  dependencies: WorkspaceCreationRouteDependencies,
  actor: PayingActor
): Promise<Set<string> | null> {
  try {
    const response = await dependencies.requestAccountService({
      actor,
      init: { body: JSON.stringify({}), method: "POST" },
      pathname: BILLING_ROUTES.plans.upstreamPathname,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const parsed = billingPlansResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return null;
    }
    const names = new Set<string>();
    for (const plan of parsed.data.plans) {
      if (plan.Prices.some((price) => price.Price > 0)) {
        names.add(plan.Name.trim());
      }
    }
    return names;
  } catch {
    return null;
  }
}

/**
 * Step 2: account-service's pay for the created Workspace. Any refusal —
 * an upstream error status, a non-JSON body, `success: false`, no checkout
 * URL — is a failed payment the page can retry, never a route error.
 */
async function startWorkspacePayment(
  dependencies: WorkspaceCreationRouteDependencies,
  actor: PayingActor,
  workspaceId: string,
  fields: WorkspacePaymentTerms
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
  if (checkout.success !== true) {
    return { error: PAYMENT_FAILED_FALLBACK, status: "failed" };
  }
  if (redirectUrl === "") {
    // account-service's balance-style path settles without a checkout URL.
    // The terms admit Stripe only, but a paid answer must be read as paid,
    // never as a failed payment the page would offer to retry.
    return {
      invoiceId:
        typeof checkout.invoiceID === "string" ? checkout.invoiceID : null,
      payId: typeof checkout.payID === "string" ? checkout.payID : null,
      status: "settled",
    };
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
    const { actor, body, response } = await authorizedCreationRequest(
      request,
      dependencies,
      workspaceCreationRequestSchema,
      "Invalid workspace creation request."
    );
    if (response != null) {
      return response;
    }
    const priced = await pricedPlanNames(dependencies, actor);
    if (priced == null) {
      log("plan catalog unreadable; refusing to create", {});
      return errorResponse("The plan catalog is unavailable. Try again.", 502);
    }
    if (!priced.has(body.planName.trim())) {
      return errorResponse("Choose a priced Subscription Plan.", 400);
    }
    const desktop = desktopForCreation(dependencies, log);
    if (!desktop.ok) {
      return desktop.response;
    }

    const created = await desktop.desktop.namespaceCreate(
      appTokenFromRequest(request),
      body.name
    );
    if (!created.ok) {
      log(
        "Desktop workspace creation failed",
        desktopFailureLogFields(created)
      );
      return desktopCreateFailureResponse(created);
    }
    const workspace: CreatedWorkspace = created.data;
    // The Workspace exists now, so a pay call that throws is an outcome,
    // never an error that would hide its id from the page.
    const payment = await startWorkspacePayment(
      dependencies,
      actor,
      workspace.id,
      body
    ).catch(
      () =>
        ({
          error: PAYMENT_FAILED_FALLBACK,
          status: "failed",
        }) as const
    );
    if (payment.status === "failed") {
      log("Workspace created but its first payment did not start", {
        workspaceId: workspace.id,
      });
    }
    return jsonResponse({ payment, workspace });
  };
}

/**
 * `POST /api/billing/workspace-create/retry-payment`: Step 2 alone. The
 * Workspace named is not the one the actor's kubeconfig proves — it was
 * just created — so Brain cannot vouch for it; account-service's pay is
 * the authority that the actor owns the Workspace it subscribes, as it is
 * for every Billing write.
 */
export function createBillingWorkspaceCreateRetryPaymentHandler(
  dependencies: WorkspaceCreationRouteDependencies
): RouteHandler {
  return async function handler(request: Request): Promise<Response> {
    const log = routeLog(
      dependencies,
      BILLING_ROUTES.workspaceCreateRetryPayment.apiPath
    );
    const { actor, body, response } = await authorizedCreationRequest(
      request,
      dependencies,
      workspaceCreationRetryRequestSchema,
      "Invalid workspace payment retry request."
    );
    if (response != null) {
      return response;
    }
    const priced = await pricedPlanNames(dependencies, actor);
    if (priced == null) {
      log("plan catalog unreadable; refusing to retry", {});
      return errorResponse("The plan catalog is unavailable. Try again.", 502);
    }
    if (!priced.has(body.planName.trim())) {
      return errorResponse("Choose a priced Subscription Plan.", 400);
    }
    const payment = await startWorkspacePayment(
      dependencies,
      actor,
      body.workspaceId,
      body
    ).catch(
      () =>
        ({
          error: PAYMENT_FAILED_FALLBACK,
          status: "failed",
        }) as const
    );
    return jsonResponse({ payment });
  };
}
