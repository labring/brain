import { beforeEach, expect, mock, test } from "bun:test";

import { BILLING_DEV_MOCK_COOKIE } from "@/features/billing/dev-mock-cookie";

/**
 * Pins the billing Dev Mock's answer on Brain's own free-turns route
 * (ADR-0073): a named scenario shapes the sidebar's usage row and the Plan
 * view's allowance card from the fixture, an absent cookie reaches the real
 * handler, and a typo fails loud instead of falling through.
 */

let realHandlerCalls = 0;

mock.module("@/features/chat/runtime/conversation-route-handlers", () => ({
  assistantConversationRouteHandlers: {
    freeTurns: () => {
      realHandlerCalls += 1;
      return Promise.resolve(Response.json({ real: true }));
    },
  },
}));

const { GET } = await import("./route");

function freeTurnsRequest(scenario?: string): Request {
  const request = new Request(
    "http://localhost/api/chat/free-turns?namespace=ns-test"
  );
  if (scenario !== undefined) {
    request.headers.set("cookie", `${BILLING_DEV_MOCK_COOKIE}=${scenario}`);
  }
  return request;
}

beforeEach(() => {
  realHandlerCalls = 0;
});

test.each([
  { scenario: "free", turns: { limit: 5, remaining: 3, used: 2 } },
  { scenario: "free-expiring", turns: { limit: 5, remaining: 0, used: 5 } },
  { scenario: "free-expired", turns: { limit: 5, remaining: 0, used: 5 } },
])("$scenario answers the free-turns fixture without reaching the real handler", async ({
  scenario,
  turns,
}) => {
  const response = await GET(freeTurnsRequest(scenario));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(turns);
  expect(realHandlerCalls).toBe(0);
});

test("an absent cookie falls through to the real handler", async () => {
  const response = await GET(freeTurnsRequest());

  expect(await response.json()).toEqual({ real: true });
  expect(realHandlerCalls).toBe(1);
});

test("an unknown scenario fails loud instead of falling through", async () => {
  const response = await GET(freeTurnsRequest("no-such-scenario"));

  expect(response.status).toBe(500);
  const body = (await response.json()) as { error: string };
  expect(body.error).toContain("no-such-scenario");
  expect(body.error).toContain("free-expiring");
  expect(realHandlerCalls).toBe(0);
});
