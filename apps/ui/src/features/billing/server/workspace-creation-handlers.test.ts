import { describe, expect, it, mock } from "bun:test";

import type { FakeDesktopOptions } from "@/features/session/server/desktop-test-double";
import type { AccountServiceRequest } from "@/lib/account-service/client-core";
import type { WorkspaceActorAuthorization } from "@/lib/request-kubeconfig-auth";
import {
  WORKSPACE_NAME_CONFLICT_CODE,
  WORKSPACE_NAME_CONFLICT_MESSAGE,
} from "../workspace-creation-schema";
import type { WorkspaceCreationRouteDependencies } from "./workspace-creation-handlers";

mock.module("server-only", () => ({}));
const {
  createBillingWorkspaceCreateHandler,
  createBillingWorkspaceCreateRetryPaymentHandler,
} = await import("./workspace-creation-handlers");
const { BILLING_ROUTES } = await import("./billing-route-table");
const { createFakeDesktop } = await import(
  "@/features/session/server/desktop-test-double"
);

const DEV_ENV = {
  DESKTOP_API_BASE_URL: "http://sealos-desktop.sealos.svc:3000",
  NODE_ENV: "development",
};
const APP_TOKEN = "app.token/with+chars";
const DESKTOP_CREATE_PATH = "/api/auth/namespace/create";
const PAY_PATH = BILLING_ROUTES.subscriptionPay.upstreamPathname;
const CREATED = {
  createTime: "2026-09-15T00:00:00.000Z",
  id: "ns-new00001",
  nstype: 0,
  role: 0,
  teamName: "Robotics",
  uid: "33333333-3333-4333-8333-333333333333",
};

const VERIFIED_ACTOR = {
  actorBinding: {
    crName: "alice-cr",
    mintedAt: 1_753_600_000,
    userId: "user-alice",
    userUid: "uid-alice",
  },
  namespace: "ns-abc12345",
  ok: true,
  workspaceActor: "alice-cr",
} satisfies WorkspaceActorAuthorization;

const VALID_CREATE_BODY = {
  name: "  Robotics ",
  payMethod: "stripe",
  period: "1m",
  planName: "Pro",
  promotionCode: "SAVE20",
  regionDomain: "us.example.test",
};

const VALID_RETRY_BODY = {
  payMethod: "stripe",
  period: "1m",
  planName: "Pro",
  regionDomain: "us.example.test",
  workspaceId: CREATED.id,
};

interface LogEntry {
  fields: Record<string, unknown>;
  message: string;
}

function billingRequest(
  apiPath: string,
  input: { body?: unknown; rawBody?: string; token?: string | null } = {}
): Request {
  const headers: Record<string, string> = {
    Authorization: "Bearer encoded-kubeconfig",
    "Content-Type": "application/json",
  };
  if (input.token !== null) {
    headers["X-Sealos-App-Token"] = input.token ?? APP_TOKEN;
  }
  return new Request(`https://brain.example.test${apiPath}`, {
    body: input.rawBody ?? JSON.stringify(input.body ?? {}),
    headers,
    method: "POST",
  });
}

function paymentAnswer(): Response {
  return Response.json({
    invoiceID: "invoice-1",
    payID: "pay-1",
    redirectUrl: "https://checkout.stripe.test/invoice-1",
    success: true,
  });
}

function harness(
  input: {
    answers?: FakeDesktopOptions["answers"];
    authorize?: () => Promise<WorkspaceActorAuthorization>;
    env?: Record<string, string | undefined>;
    pay?: (request: AccountServiceRequest) => Response;
  } = {}
) {
  const desktop = createFakeDesktop({
    answers: input.answers ?? {
      [DESKTOP_CREATE_PATH]: { code: 200, data: { namespace: CREATED } },
    },
  });
  const accountRequests: AccountServiceRequest[] = [];
  const logs: LogEntry[] = [];
  const dependencies: WorkspaceCreationRouteDependencies = {
    authorizeWorkspaceActor:
      input.authorize ?? (() => Promise.resolve(VERIFIED_ACTOR)),
    env: input.env ?? DEV_ENV,
    fetchDesktop: desktop.fetch,
    log: (message, fields) => logs.push({ fields, message }),
    requestAccountService: (request) => {
      accountRequests.push(request);
      return Promise.resolve((input.pay ?? paymentAnswer)(request));
    },
  };
  return {
    accountRequests,
    create: createBillingWorkspaceCreateHandler(dependencies),
    desktopCalls: desktop.calls,
    logs,
    retry: createBillingWorkspaceCreateRetryPaymentHandler(dependencies),
  };
}

const CREATE_PATH = BILLING_ROUTES.workspaceCreate.apiPath;
const RETRY_PATH = BILLING_ROUTES.workspaceCreateRetryPayment.apiPath;

describe(`POST ${CREATE_PATH}`, () => {
  it("creates the Workspace with the raw app token, then starts the payment as Brain", async () => {
    const { accountRequests, create, desktopCalls } = harness();
    const response = await create(
      billingRequest(CREATE_PATH, { body: VALID_CREATE_BODY })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      payment: {
        invoiceId: "invoice-1",
        payId: "pay-1",
        redirectUrl: "https://checkout.stripe.test/invoice-1",
        status: "started",
      },
      workspace: { id: CREATED.id, name: "Robotics", uid: CREATED.uid },
    });
    expect(desktopCalls).toEqual([
      {
        authorization: APP_TOKEN,
        body: { teamName: "Robotics", userType: "subscription" },
        method: "POST",
        path: DESKTOP_CREATE_PATH,
      },
    ]);
    expect(accountRequests).toHaveLength(1);
    const pay = accountRequests[0];
    expect(pay?.pathname).toBe(PAY_PATH);
    expect(pay?.actor).toEqual({ userId: "user-alice", userUid: "uid-alice" });
    expect(pay?.init?.method).toBe("POST");
    expect(JSON.parse(String(pay?.init?.body))).toEqual({
      operator: "created",
      payApp: "system-brain",
      payMethod: "stripe",
      period: "1m",
      planName: "Pro",
      promotionCode: "SAVE20",
      regionDomain: "us.example.test",
      workspace: CREATED.id,
    });
  });

  it("answers 409 with the name-conflict code when Desktop refuses the name, never paying", async () => {
    const { accountRequests, create } = harness({
      answers: {
        [DESKTOP_CREATE_PATH]: {
          code: 409,
          message: "The team is already exist",
        },
      },
    });
    const response = await create(
      billingRequest(CREATE_PATH, { body: VALID_CREATE_BODY })
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: WORKSPACE_NAME_CONFLICT_CODE,
      error: WORKSPACE_NAME_CONFLICT_MESSAGE,
    });
    expect(accountRequests).toEqual([]);
  });

  it("translates Desktop's other refusals and transport failures without its message text", async () => {
    for (const [answer, status] of [
      [{ code: 403, message: "max workspaces" }, 403],
      [{ code: 401, message: "token verify error" }, 401],
      [{ code: 500, message: "failed to create team" }, 502],
      [new Response("bad gateway", { status: 502 }), 502],
      [Object.assign(new Error("timed out"), { name: "TimeoutError" }), 504],
      [new Error("connection refused"), 502],
    ] as const) {
      const { accountRequests, create, logs } = harness({
        answers: { [DESKTOP_CREATE_PATH]: answer },
      });
      const response = await create(
        billingRequest(CREATE_PATH, { body: VALID_CREATE_BODY })
      );
      expect(response.status).toBe(status);
      const payload = (await response.json()) as { error: string };
      expect(payload.error).not.toContain("max workspaces");
      expect(payload.error).not.toContain("failed to create team");
      expect(accountRequests).toEqual([]);
      expect(JSON.stringify(logs)).not.toContain(APP_TOKEN);
      expect(JSON.stringify(logs)).not.toContain("encoded-kubeconfig");
    }
  });

  it("answers 200 with a failed payment when Step 2 fails after the Workspace exists", async () => {
    for (const pay of [
      () => Response.json({ error: "card declined" }, { status: 402 }),
      () =>
        Response.json(
          { error: "Account service is unavailable." },
          {
            status: 502,
          }
        ),
      () => Response.json({ success: false }),
      () => new Response("not json"),
    ]) {
      const { create, logs } = harness({ pay });
      const response = await create(
        billingRequest(CREATE_PATH, { body: VALID_CREATE_BODY })
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        payment: { error: string; status: string };
        workspace: { id: string };
      };
      expect(payload.workspace.id).toBe(CREATED.id);
      expect(payload.payment.status).toBe("failed");
      expect(payload.payment.error.length).toBeGreaterThan(0);
      expect(JSON.stringify(logs)).not.toContain(APP_TOKEN);
    }
  });

  it("answers 400 for an invalid body, never calling Desktop", async () => {
    const { accountRequests, create, desktopCalls } = harness();
    for (const body of [
      {},
      { ...VALID_CREATE_BODY, name: "   " },
      { ...VALID_CREATE_BODY, name: "x".repeat(33) },
      { ...VALID_CREATE_BODY, planName: "" },
      { ...VALID_CREATE_BODY, period: "2m" },
      { ...VALID_CREATE_BODY, payMethod: "cash" },
      { ...VALID_CREATE_BODY, regionDomain: undefined },
    ]) {
      const response = await create(billingRequest(CREATE_PATH, { body }));
      expect(response.status).toBe(400);
    }
    const nonJson = await create(
      billingRequest(CREATE_PATH, { rawBody: "not json" })
    );
    expect(nonJson.status).toBe(400);
    expect(desktopCalls).toEqual([]);
    expect(accountRequests).toEqual([]);
  });

  it("refuses a failed actor binding with 401 before touching Desktop", async () => {
    const { accountRequests, create, desktopCalls } = harness({
      authorize: () =>
        Promise.resolve({
          code: "app_token_mismatch",
          message: "App token does not match the authenticated actor.",
          ok: false,
          status: 403,
        }),
    });
    const response = await create(
      billingRequest(CREATE_PATH, { body: VALID_CREATE_BODY })
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "Authentication is required.",
    });
    expect(desktopCalls).toEqual([]);
    expect(accountRequests).toEqual([]);
  });

  it("answers 502 when Desktop is not configured", async () => {
    const { create, desktopCalls } = harness({
      env: { NODE_ENV: "development" },
    });
    const response = await create(
      billingRequest(CREATE_PATH, { body: VALID_CREATE_BODY })
    );
    expect(response.status).toBe(502);
    expect(desktopCalls).toEqual([]);
  });
});

describe(`POST ${RETRY_PATH}`, () => {
  it("redoes only Step 2 for the created Workspace", async () => {
    const { accountRequests, desktopCalls, retry } = harness();
    const response = await retry(
      billingRequest(RETRY_PATH, { body: VALID_RETRY_BODY })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      payment: {
        invoiceId: "invoice-1",
        payId: "pay-1",
        redirectUrl: "https://checkout.stripe.test/invoice-1",
        status: "started",
      },
    });
    expect(desktopCalls).toEqual([]);
    expect(accountRequests).toHaveLength(1);
    expect(JSON.parse(String(accountRequests[0]?.init?.body))).toEqual({
      operator: "created",
      payApp: "system-brain",
      payMethod: "stripe",
      period: "1m",
      planName: "Pro",
      regionDomain: "us.example.test",
      workspace: CREATED.id,
    });
  });

  it("answers 200 with a failed payment when account-service refuses again", async () => {
    const { retry } = harness({
      pay: () => Response.json({ error: "card declined" }, { status: 402 }),
    });
    const response = await retry(
      billingRequest(RETRY_PATH, { body: VALID_RETRY_BODY })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      payment: { error: "card declined", status: "failed" },
    });
  });

  it("answers 400 for an invalid body and 401 for a failed binding", async () => {
    const { accountRequests, retry } = harness();
    for (const body of [
      {},
      { ...VALID_RETRY_BODY, workspaceId: " " },
      { ...VALID_RETRY_BODY, period: "1w" },
    ]) {
      const response = await retry(billingRequest(RETRY_PATH, { body }));
      expect(response.status).toBe(400);
    }
    expect(accountRequests).toEqual([]);

    const unauthorized = harness({
      authorize: () =>
        Promise.resolve({
          code: "workspace_actor_required",
          message: "A verified Workspace Actor is required.",
          ok: false,
          status: 403,
        }),
    });
    const response = await unauthorized.retry(
      billingRequest(RETRY_PATH, { body: VALID_RETRY_BODY })
    );
    expect(response.status).toBe(401);
    expect(unauthorized.accountRequests).toEqual([]);
  });
});
