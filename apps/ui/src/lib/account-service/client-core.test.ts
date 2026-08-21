import assert from "node:assert/strict";
import { test } from "node:test";

import { jwtVerify } from "jose";

import { createAccountServiceClient } from "./client-core";

const CONFIG = {
  baseUrl: "https://account-api.example.test",
  signingSecret: "signing-secret",
};
const ACTOR = {
  userId: "user-123",
  userUid: "6bd90648-b8b9-4a70-9be0-95c8391a0dcb",
};
const BEARER_HEADER_PATTERN = /^Bearer /;
const MISSING_VERIFIED_ACTOR_PATTERN = /verified userId and userUid/;

test("requires both verified account identifiers before making a call", async () => {
  let fetchCalls = 0;
  const client = createAccountServiceClient({
    config: CONFIG,
    fetch: () => {
      fetchCalls += 1;
      return Promise.resolve(Response.json({ ok: true }));
    },
  });
  for (const actor of [
    { userId: null, userUid: ACTOR.userUid },
    { userId: ACTOR.userId, userUid: "  " },
  ]) {
    await assert.rejects(
      client({
        actor,
        pathname: "/account/v1alpha1/properties",
      }),
      MISSING_VERIFIED_ACTOR_PATTERN
    );
  }
  assert.equal(fetchCalls, 0);
});

test("signs a fresh five-minute HS256 actor token for every call", async () => {
  const authorizationHeaders: string[] = [];
  const clock = [1_753_600_000, 1_753_600_001];
  const client = createAccountServiceClient({
    config: CONFIG,
    fetch: (_input, init) => {
      authorizationHeaders.push(
        new Headers(init?.headers).get("Authorization") ?? ""
      );
      return Promise.resolve(Response.json({ ok: true }));
    },
    nowSeconds: () => clock.shift() ?? 0,
  });

  await client({ actor: ACTOR, pathname: "/account/v1alpha1/properties" });
  await client({ actor: ACTOR, pathname: "/account/v1alpha1/properties" });

  assert.equal(authorizationHeaders.length, 2);
  const payloads = await Promise.all(
    authorizationHeaders.map(async (header) => {
      assert.match(header, BEARER_HEADER_PATTERN);
      const verified = await jwtVerify(
        header.slice("Bearer ".length),
        new TextEncoder().encode(CONFIG.signingSecret),
        {
          algorithms: ["HS256"],
          currentDate: new Date(1_753_600_001_000),
        }
      );
      assert.equal(verified.protectedHeader.alg, "HS256");
      return verified.payload;
    })
  );
  assert.deepEqual(payloads, [
    {
      exp: 1_753_600_300,
      iat: 1_753_600_000,
      userId: ACTOR.userId,
      userUid: ACTOR.userUid,
    },
    {
      exp: 1_753_600_301,
      iat: 1_753_600_001,
      userId: ACTOR.userId,
      userUid: ACTOR.userUid,
    },
  ]);
});

test("passes through an upstream error status with a normalized error body", async () => {
  const client = createAccountServiceClient({
    config: CONFIG,
    fetch: () =>
      Promise.resolve(
        Response.json(
          { code: 404, message: "Workspace subscription was not found" },
          { status: 404 }
        )
      ),
  });

  const response = await client({
    actor: ACTOR,
    pathname: "/account/v1alpha1/workspace-subscription/info",
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Workspace subscription was not found",
  });
});

test("maps transport failures to a detail-free bad gateway response", async () => {
  const internalDetail = "connect ECONNREFUSED 10.0.0.12:2333";
  const client = createAccountServiceClient({
    config: CONFIG,
    fetch: () => Promise.reject(new Error(internalDetail)),
  });

  const response = await client({
    actor: ACTOR,
    pathname: "/account/v1alpha1/properties",
  });
  const body = (await response.json()) as { error: string };

  assert.equal(response.status, 502);
  assert.deepEqual(body, { error: "Account service is unavailable." });
  assert.equal(body.error.includes(internalDetail), false);
});

test("passes a successful body through without an envelope", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const client = createAccountServiceClient({
    config: CONFIG,
    fetch: (input, init) => {
      requestUrl = input.toString();
      requestInit = init;
      return Promise.resolve(
        Response.json({ planName: "Pro", price: 12 }, { status: 201 })
      );
    },
  });

  const response = await client({
    actor: ACTOR,
    init: {
      body: JSON.stringify({ workspace: "ns-alice" }),
      method: "POST",
    },
    pathname: "/account/v1alpha1/workspace-subscription/pay",
  });

  assert.equal(
    requestUrl,
    "https://account-api.example.test/account/v1alpha1/workspace-subscription/pay"
  );
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(
    new Headers(requestInit?.headers).get("Content-Type"),
    "application/json"
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { planName: "Pro", price: 12 });
});
