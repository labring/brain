import { describe, expect, it } from "bun:test";

import {
  chatBillingInterruptionCopy,
  chatBillingInterruptionFromError,
  chatBillingWallCopy,
} from "./chat-billing-interruption";

describe("chatBillingInterruptionFromError", () => {
  it("reads a mid-stream aiproxy refusal with its paid source", () => {
    const error = new Error(
      JSON.stringify({
        code: "ai_proxy_billing_refused",
        detail: { paidSource: "ai-credits" },
        error: "The AI proxy refused this turn for billing reasons.",
      })
    );
    expect(chatBillingInterruptionFromError(error, "balance")).toEqual({
      paidSource: "ai-credits",
    });
  });

  it("falls back to the pane's known paid source when the refusal carries none", () => {
    const error = new Error(
      JSON.stringify({ code: "ai_proxy_billing_refused", error: "refused" })
    );
    expect(chatBillingInterruptionFromError(error, "balance")).toEqual({
      paidSource: "balance",
    });
    expect(chatBillingInterruptionFromError(error, null)).toEqual({
      paidSource: null,
    });
  });

  it("reads the pre-send wall refusals too, so a 402 that slipped past the panel reads truthfully", () => {
    expect(
      chatBillingInterruptionFromError(
        new Error(
          JSON.stringify({ code: "account_balance_exhausted", error: "x" })
        ),
        null
      )
    ).toEqual({ paidSource: "balance" });
    expect(
      chatBillingInterruptionFromError(
        new Error(JSON.stringify({ code: "ai_credits_exhausted", error: "x" })),
        null
      )
    ).toEqual({ paidSource: "ai-credits" });
  });

  it("reads the allowance refusal as a billing refusal with no Paid Source (ADR-0073)", () => {
    expect(
      chatBillingInterruptionFromError(
        new Error(JSON.stringify({ code: "ai_allowance_missing", error: "x" })),
        "ai-credits"
      )
    ).toEqual({ paidSource: null });
  });

  it("is null for every non-billing error, including non-JSON messages", () => {
    expect(
      chatBillingInterruptionFromError(new Error("An error occurred."), null)
    ).toBeNull();
    expect(
      chatBillingInterruptionFromError(
        new Error(JSON.stringify({ code: "invalid_request", error: "x" })),
        "balance"
      )
    ).toBeNull();
  });
});

describe("copy forks by Chat Billing Mode", () => {
  it("speaks AI Credits and an upgrade for a subscribed workspace", () => {
    expect(chatBillingWallCopy("ai-credits")).toEqual({
      body: "This workspace's AI Credits are exhausted. Upgrade the plan to keep chatting.",
      cta: { destination: "upgrade", label: "Upgrade plan" },
      title: "AI Credits used up",
    });
    expect(chatBillingInterruptionCopy("ai-credits").title).toBe(
      "Message not sent — AI Credits used up"
    );
  });

  it("speaks the balance and a top-up for PAYG", () => {
    expect(chatBillingWallCopy("balance")).toEqual({
      body: "Chat is paused because your account balance can't cover AI usage. Top up to continue.",
      cta: { destination: "top-up", label: "Top up balance" },
      title: "Account balance in debt",
    });
    expect(chatBillingInterruptionCopy("balance").cta.label).toBe(
      "Top up balance"
    );
  });

  it("speaks the allowance causes truthfully (ADR-0073)", () => {
    expect(chatBillingWallCopy("allowance-trial").title).toBe(
      "Free trial messages used up"
    );
    expect(chatBillingWallCopy("allowance-plan").title).toBe(
      "AI usage not included"
    );
  });

  it("never claims a source it does not know", () => {
    const copy = chatBillingInterruptionCopy(null);
    expect(copy.title).toBe("Message not sent — billing refused the request");
    expect(copy.cta).toEqual({ destination: "plans", label: "View billing" });
  });
});
