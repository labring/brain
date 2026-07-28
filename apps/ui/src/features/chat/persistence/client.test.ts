import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { fetchAssistantSession, fetchAssistantThreads } from "./client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("conversation list and bootstrap requests do not send a client-owned user id", async () => {
  const requestedUrls: string[] = [];
  const appTokenHeaders: (string | null)[] = [];
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    requestedUrls.push(String(input));
    appTokenHeaders.push(new Headers(init?.headers).get("X-Sealos-App-Token"));
    const pathname = new URL(String(input), "https://brain.test").pathname;
    return Promise.resolve(
      Response.json(
        pathname.endsWith("/session")
          ? {
              chatId: "chat-1",
              freeTier: { billing: "free", limit: 10, remaining: 10 },
              messages: [],
              threads: [],
            }
          : { threads: [] }
      )
    );
  }) as typeof fetch;

  await fetchAssistantSession("shared", "encoded-kubeconfig", "app-token");
  await fetchAssistantThreads("shared", "encoded-kubeconfig", "app-token");

  assert.deepEqual(requestedUrls, [
    "/api/chat/session?namespace=shared",
    "/api/chat/threads?namespace=shared",
  ]);
  assert.deepEqual(appTokenHeaders, ["app-token", "app-token"]);
});
