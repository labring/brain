import { describe, expect, test } from "bun:test";
import { chatDevMockResponse, chatDevMockStreamResponse } from "./dev-fixtures";
import {
  CHAT_DEV_SCENARIOS,
  chatDevMockCookie,
  isChatDevRefusalScenario,
} from "./dev-mock-cookie";
import { readSelectedResourceContext } from "./persistence/types";

function request(path: string, scenario: string): Request {
  const req = new Request(`http://localhost${path}`);
  req.headers.set("cookie", `${chatDevMockCookie.name}=${scenario}`);
  return req;
}

function sendRequest(scenario: string): Request {
  const req = new Request("http://localhost/api/chat", {
    body: JSON.stringify({ chatId: "mock-chat-short", message: {} }),
    method: "POST",
  });
  req.headers.set("cookie", `${chatDevMockCookie.name}=${scenario}`);
  return req;
}

/** Every `data:` JSON chunk of a UI message SSE stream, in order. */
async function streamChunks(
  response: Response
): Promise<Record<string, unknown>[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice("data: ".length)));
}

const realSession = () =>
  Promise.resolve(
    Response.json({
      chatId: "real",
      freeTier: { billing: "blocked", limit: 10, remaining: 0 },
      messages: [],
      threads: [],
    })
  );
const realDown = () =>
  Promise.resolve(Response.json({ error: "down" }, { status: 503 }));

interface SessionBody {
  chatId: string;
  freeTier: { billing: string };
  messages: { id: string; parts: unknown[]; role: string }[];
  threads: { id: string }[];
}

describe("conversation dev fixtures", () => {
  for (const scenario of CHAT_DEV_SCENARIOS) {
    test(`${scenario} bootstraps a session whose thread is in the list`, async () => {
      const response = await chatDevMockResponse(
        "session",
        request("/api/chat/session?namespace=ns-test", scenario),
        realSession
      );
      const body = (await response.json()) as SessionBody;
      // The refusal scenarios stage the short transcript: the scene is the
      // interrupted reply, not the history behind it.
      expect(body.chatId).toBe(
        isChatDevRefusalScenario(scenario)
          ? "mock-chat-short"
          : `mock-chat-${scenario}`
      );
      if (scenario !== "empty") {
        expect(body.threads.map((thread) => thread.id)).toContain(body.chatId);
      }
      const messages = await chatDevMockResponse(
        "messages",
        request(
          `/api/chat/messages?chatId=${body.chatId}&namespace=ns-test`,
          scenario
        ),
        realDown
      );
      const list = (await messages.json()) as Pick<SessionBody, "messages">;
      expect(list.messages).toEqual(body.messages);
    });
  }

  test("keeps the real Chat Billing Mode when the real handler answers", async () => {
    const response = await chatDevMockResponse(
      "session",
      request("/api/chat/session?namespace=ns-test", "short"),
      realSession
    );
    const body = (await response.json()) as SessionBody;
    expect(body.freeTier.billing).toBe("blocked");
    expect(body.messages).toHaveLength(4);
  });

  test("falls back to a neutral posture when the real handler cannot", async () => {
    const response = await chatDevMockResponse(
      "session",
      request("/api/chat/session?namespace=ns-test", "long"),
      realDown
    );
    const body = (await response.json()) as SessionBody;
    expect(body.freeTier.billing).toBe("user");
  });

  test("long carries tool cards in every state and a pinned context", async () => {
    const response = await chatDevMockResponse(
      "session",
      request("/api/chat/session?namespace=ns-test", "long"),
      realDown
    );
    const body = (await response.json()) as SessionBody;
    const states = new Set(
      body.messages.flatMap((message) =>
        message.parts.flatMap((part) => {
          const candidate = part as { state?: string; type: string };
          return candidate.type.startsWith("tool-") && candidate.state != null
            ? [candidate.state]
            : [];
        })
      )
    );
    expect([...states].sort()).toEqual(
      ["approval-requested", "output-available", "output-error"].sort()
    );
    const pinned = body.messages
      .map((message) =>
        readSelectedResourceContext(
          message as Parameters<typeof readSelectedResourceContext>[0]
        )
      )
      .find((context) => context != null);
    expect(pinned?.name).toBe("web-app");
  });

  test("an unknown thread and an off cookie fall through", async () => {
    const unknown = await chatDevMockResponse(
      "messages",
      request(
        "/api/chat/messages?chatId=real-thread&namespace=ns-test",
        "long"
      ),
      realDown
    );
    expect(unknown.status).toBe(503);
    const off = await chatDevMockResponse(
      "session",
      request("/api/chat/session?namespace=ns-test", "off:long"),
      realSession
    );
    expect(((await off.json()) as SessionBody).chatId).toBe("real");
  });

  test("a refusal scenario answers the send with a stream that dies on a billing refusal", async () => {
    for (const [scenario, paidSource] of [
      ["refused-ai-credits", "ai-credits"],
      ["refused-balance", "balance"],
    ] as const) {
      const response = await chatDevMockStreamResponse(sendRequest(scenario));
      expect(response).not.toBeNull();
      if (response == null) {
        return;
      }
      expect(response.headers.get("X-Chat-Billing")).toBe("user");
      expect(response.headers.get("X-Chat-Paid-Source")).toBe(paidSource);
      expect(response.headers.get("X-Chat-Wall")).toBe("");
      expect(response.headers.get("X-Chat-Free-Remaining")).toBe("0");
      expect(response.headers.get("X-Chat-Free-Limit")).toBe("0");

      const chunks = await streamChunks(response);
      const deltas = chunks.filter((chunk) => chunk.type === "text-delta");
      expect(deltas.length).toBeGreaterThan(0);
      const error = chunks.find((chunk) => chunk.type === "error");
      expect(error).toBeDefined();
      const body = JSON.parse(String(error?.errorText)) as {
        code: string;
        detail: { paidSource: string };
      };
      expect(body.code).toBe("ai_proxy_billing_refused");
      expect(body.detail.paidSource).toBe(paidSource);
      // The reply dies mid-stream: nothing after the refusal.
      expect(chunks.at(-1)?.type).toBe("error");
    }
  });

  test("the send passes through untouched outside a refusal scenario", async () => {
    expect(await chatDevMockStreamResponse(sendRequest("long"))).toBeNull();
    expect(
      await chatDevMockStreamResponse(sendRequest("off:refused-balance"))
    ).toBeNull();
    const invalid = await chatDevMockStreamResponse(sendRequest("bogus"));
    expect(invalid?.status).toBe(500);
  });
});
