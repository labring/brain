import { describe, expect, mock, test } from "bun:test";
import type { UIMessage } from "ai";

mock.module("server-only", () => ({}));

const { withAssistantUsageContext } = await import("./assistant-usage-context");

function userMessage(id: string, text: string): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  } as unknown as UIMessage;
}

describe("withAssistantUsageContext", () => {
  test("injects only the latest user turn", () => {
    const history = [
      userMessage("u-1", "first"),
      { id: "a-1", role: "assistant", parts: [{ type: "text", text: "ok" }] },
      userMessage("u-2", "second"),
    ] as UIMessage[];

    const [first, assistant, latest] = withAssistantUsageContext(history, {
      aiQuota: {
        status: "available",
        totalMicroUnits: 20_000_000,
        usedMicroUnits: 5_000_000,
      },
      freeTier: { billing: "free", limit: 5, remaining: 3 },
    });

    expect(first).toBe(history[0]);
    expect(assistant).toBe(history[1]);
    const injected = latest?.parts[0];
    const injectedText = injected as { text?: string; type?: string };
    expect(injectedText.type).toBe("text");
    if (injectedText.type !== "text" || injectedText.text == null) {
      throw new Error("expected an injected text part");
    }
    expect(injectedText.text).toContain(
      "Workspace AI Credits: 2,000 total, 500 used, 1,500 remaining"
    );
    expect(injectedText.text).toContain(
      "Free assistant messages: 3 remaining of 5"
    );
    expect(latest?.parts.at(-1)).toEqual({ type: "text", text: "second" });
  });

  test("does not turn unavailable quota into zero", () => {
    const [message] = withAssistantUsageContext(
      [userMessage("u-3", "status")],
      {
        aiQuota: { status: "unavailable" },
        freeTier: { billing: "user", limit: 0, remaining: 0 },
      }
    );

    const text = message?.parts[0] as { text?: string; type?: string };
    expect(text.type).toBe("text");
    expect(text.text).toContain("temporarily unavailable; do not infer zero");
    expect(text.text).not.toContain("AI Credits: 0");
  });
});
