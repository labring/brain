import { describe, expect, it } from "bun:test";
import { APICallError } from "ai";

import {
  chatStreamErrorText,
  isAiProxyBillingRefusal,
} from "./ai-proxy-billing-refusal";

function apiError(input: {
  body?: string;
  message?: string;
  statusCode: number;
}): APICallError {
  return new APICallError({
    message: input.message ?? "Forbidden",
    requestBodyValues: {},
    responseBody: input.body,
    statusCode: input.statusCode,
    url: "https://aiproxy.example/v1/chat/completions",
  });
}

describe("isAiProxyBillingRefusal", () => {
  it("recognizes aiproxy's group_balance_not_enough 403 by its typed body", () => {
    expect(
      isAiProxyBillingRefusal({
        bodyText:
          '{"type":"group_balance_not_enough","message":"group `ns-x` balance not enough"}',
        status: 403,
      })
    ).toBe(true);
  });

  it("recognizes the refusal by its message when the body is not typed", () => {
    expect(
      isAiProxyBillingRefusal({
        bodyText: "group `ns-x` balance not enough",
        status: 403,
      })
    ).toBe(true);
  });

  it("does not mistake other 403s or other statuses for billing", () => {
    expect(
      isAiProxyBillingRefusal({ bodyText: "model not allowed", status: 403 })
    ).toBe(false);
    expect(
      isAiProxyBillingRefusal({
        bodyText: '{"type":"group_balance_not_enough"}',
        status: 500,
      })
    ).toBe(false);
  });
});

describe("chatStreamErrorText", () => {
  it("emits the billing refusal code with the paid source for a mid-stream aiproxy refusal", () => {
    const text = chatStreamErrorText(
      apiError({
        body: '{"type":"group_balance_not_enough","message":"group `ns-x` balance not enough"}',
        statusCode: 403,
      }),
      "ai-credits"
    );
    expect(JSON.parse(text)).toEqual({
      code: "ai_proxy_billing_refused",
      detail: { paidSource: "ai-credits" },
      error: "The AI proxy refused this turn for billing reasons.",
    });
  });

  it("masks every other error instead of echoing upstream text", () => {
    expect(
      chatStreamErrorText(apiError({ body: "secret", statusCode: 500 }), null)
    ).toBe("An error occurred.");
    expect(chatStreamErrorText(new Error("ECONNRESET"), "balance")).toBe(
      "An error occurred."
    );
  });
});
