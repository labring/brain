import assert from "node:assert/strict";
import { test } from "node:test";

import { createAccountServiceClient } from "@/lib/account-service/client-core";
import type { WorkspaceActorAuthorization } from "@/lib/request-kubeconfig-auth";
import { createBillingSubscriptionUpgradeAmountHandler } from "./handler";

const VERIFIED_ACTOR = {
  actorBinding: {
    crName: "alice-cr",
    mintedAt: 1_753_600_000,
    userId: "user-alice",
    userUid: "uid-alice",
  },
  namespace: "workspace-a",
  ok: true,
  workspaceActor: "alice-cr",
} satisfies WorkspaceActorAuthorization;

function upgradeAmountRequest() {
  return new Request(
    "https://brain.example.test/api/billing/subscription/upgrade-amount",
    {
      body: JSON.stringify({
        operator: "upgraded",
        payMethod: "stripe",
        period: "1m",
        planName: "Team",
        promotionCode: "SAVE20",
        regionDomain: "us.example.test",
        workspace: "workspace-a",
      }),
      headers: {
        Authorization: "Bearer encoded-kubeconfig",
        "Content-Type": "application/json",
        "X-Sealos-App-Token": "desktop-app-token",
      },
      method: "POST",
    }
  );
}

test("upgrade amount route preserves only validated pending subscription upgrade fields", async () => {
  const requestAccountService = createAccountServiceClient({
    config: {
      baseUrl: "https://account-api.example.test",
      signingSecret: "signing-secret",
    },
    fetch: () =>
      Promise.resolve(
        Response.json(
          {
            code: 409,
            error: "Stripe customer cus_secret has an unpaid invoice.",
            internal_trace: "stripe customer cus_secret",
            pending_upgrade: {
              amount_due: 7_500_000,
              created_at: 1_753_600_000,
              currency: "usd",
              invoice_id: "invoice-1",
              payment_id: "payment-1",
              payment_url: "https://checkout.stripe.test/invoice-1",
              plan_name: "Team",
              provider_secret: "must-not-pass",
              status: "open",
            },
          },
          { status: 409 }
        )
      ),
  });
  const handler = createBillingSubscriptionUpgradeAmountHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService,
  });

  const response = await handler(upgradeAmountRequest());

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "An unpaid subscription upgrade already exists.",
    pending_upgrade: {
      amount_due: 7_500_000,
      created_at: 1_753_600_000,
      currency: "usd",
      invoice_id: "invoice-1",
      payment_id: "payment-1",
      payment_url: "https://checkout.stripe.test/invoice-1",
      plan_name: "Team",
      status: "open",
    },
  });
});

// Mirrors the 409 body account-service actually builds (sealos
// service/account/api/workspace_subscription.go): `original_plan.period` reads
// the `old_period` invoice metadata that is never written, so production always
// sends "" there — the shape the legacy hand-written fixture never exercised.
test("upgrade amount route recovers the production 409 body and strips original_plan", async () => {
  const requestAccountService = createAccountServiceClient({
    config: {
      baseUrl: "https://account-api.example.test",
      signingSecret: "signing-secret",
    },
    fetch: () =>
      Promise.resolve(
        Response.json(
          {
            code: 409,
            error:
              "There is already an unpaid upgrade in progress to plan Team. Please complete the payment before requesting a new upgrade.",
            pending_upgrade: {
              amount_due: 7_500_000,
              created_at: 1_753_600_000,
              currency: "usd",
              discount_amount: 0,
              has_discount: false,
              invoice_id: "invoice-1",
              original_amount: 6_000_000,
              original_plan: {
                period: "",
                plan_name: "Hobby",
                price: 6_000_000,
              },
              payment_id: "payment-1",
              payment_url: "https://checkout.stripe.test/invoice-1",
              plan_name: "Team",
              promotion_code: "",
              status: "open",
              total_amount: 7_500_000,
            },
          },
          { status: 409 }
        )
      ),
  });
  const handler = createBillingSubscriptionUpgradeAmountHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService,
  });

  const response = await handler(upgradeAmountRequest());

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "An unpaid subscription upgrade already exists.",
    pending_upgrade: {
      amount_due: 7_500_000,
      created_at: 1_753_600_000,
      currency: "usd",
      discount_amount: 0,
      has_discount: false,
      invoice_id: "invoice-1",
      original_amount: 6_000_000,
      payment_id: "payment-1",
      payment_url: "https://checkout.stripe.test/invoice-1",
      plan_name: "Team",
      promotion_code: "",
      status: "open",
      total_amount: 7_500_000,
    },
  });
});

test("upgrade amount route tolerates an empty plan name from legacy invoice metadata", async () => {
  const requestAccountService = createAccountServiceClient({
    config: {
      baseUrl: "https://account-api.example.test",
      signingSecret: "signing-secret",
    },
    fetch: () =>
      Promise.resolve(
        Response.json(
          {
            code: 409,
            error:
              "There is already an unpaid upgrade in progress to plan . Please complete the payment before requesting a new upgrade.",
            pending_upgrade: {
              amount_due: 7_500_000,
              created_at: 1_753_600_000,
              currency: "usd",
              invoice_id: "invoice-1",
              payment_id: "payment-1",
              payment_url: "https://checkout.stripe.test/invoice-1",
              plan_name: "",
              status: "open",
            },
          },
          { status: 409 }
        )
      ),
  });
  const handler = createBillingSubscriptionUpgradeAmountHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService,
  });

  const response = await handler(upgradeAmountRequest());

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "An unpaid subscription upgrade already exists.",
    pending_upgrade: {
      amount_due: 7_500_000,
      created_at: 1_753_600_000,
      currency: "usd",
      invoice_id: "invoice-1",
      payment_id: "payment-1",
      payment_url: "https://checkout.stripe.test/invoice-1",
      plan_name: "",
      status: "open",
    },
  });
});

test("upgrade amount route marks malformed pending recovery without leaking it", async () => {
  const requestAccountService = createAccountServiceClient({
    config: {
      baseUrl: "https://account-api.example.test",
      signingSecret: "signing-secret",
    },
    fetch: () =>
      Promise.resolve(
        Response.json(
          {
            error: "existing invoice lookup exposed an internal detail",
            pending_upgrade: {
              invoice_id: "invoice-1",
              payment_url: "javascript:alert('unsafe')",
              provider_secret: "must-not-pass",
            },
          },
          { status: 409 }
        )
      ),
  });
  const handler = createBillingSubscriptionUpgradeAmountHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService,
  });

  const response = await handler(upgradeAmountRequest());

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    code: "invalid_pending_upgrade",
    error: "The existing subscription payment could not be recovered.",
  });
});

test("upgrade amount route keeps an ordinary promotion conflict normalized", async () => {
  const requestAccountService = createAccountServiceClient({
    config: {
      baseUrl: "https://account-api.example.test",
      signingSecret: "signing-secret",
    },
    fetch: () =>
      Promise.resolve(
        Response.json(
          { error: "Promotion code reached maximum redemption." },
          { status: 409 }
        )
      ),
  });
  const handler = createBillingSubscriptionUpgradeAmountHandler({
    authorizeWorkspaceActor: () => Promise.resolve(VERIFIED_ACTOR),
    requestAccountService,
  });

  const response = await handler(upgradeAmountRequest());

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "Promotion code reached maximum redemption.",
  });
});
