import { mock, test } from "bun:test";
import assert from "node:assert/strict";

mock.module("server-only", () => ({}));
mock.module("./lifecycle-registration", () => ({
  recordChatDevboxActivity: () => Promise.resolve(),
}));

const { bootstrapChatDevboxIfNeeded } = await import("./chat-runtime");

test("Devbox readiness polling stops while sleeping when the tool call aborts", async () => {
  const originalFetch = globalThis.fetch;
  const originalBaseUrl = process.env.DEVBOX_API_BASE_URL;
  const originalToken = process.env.DEVBOX_TOKEN;
  const controller = new AbortController();
  let getCalls = 0;

  process.env.DEVBOX_API_BASE_URL = "https://devbox.test";
  process.env.DEVBOX_TOKEN = "test-token";
  globalThis.fetch = ((input) => {
    const url = new URL(String(input));
    if (url.searchParams.has("upstreamID")) {
      return Promise.resolve(
        Response.json({ data: { items: [{ name: "existing-runtime" }] } })
      );
    }

    getCalls += 1;
    queueMicrotask(() => controller.abort());
    return Promise.resolve(
      Response.json(
        { message: "get devbox private key failed: secret not found" },
        { status: 500 }
      )
    );
  }) as typeof fetch;

  try {
    await assert.rejects(
      bootstrapChatDevboxIfNeeded(
        { kubeconfig: "apiVersion: v1", namespace: "ns-test" },
        controller.signal
      ),
      (error: unknown) =>
        error instanceof DOMException && error.name === "AbortError"
    );
    assert.equal(getCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) {
      delete process.env.DEVBOX_API_BASE_URL;
    } else {
      process.env.DEVBOX_API_BASE_URL = originalBaseUrl;
    }
    if (originalToken === undefined) {
      delete process.env.DEVBOX_TOKEN;
    } else {
      process.env.DEVBOX_TOKEN = originalToken;
    }
  }
});
