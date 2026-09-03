import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  fetchAssistantSession,
  fetchAssistantThreadMessages,
  fetchAssistantThreads,
} from "./client";

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

  const credentials = {
    appToken: "app-token",
    kubeconfig: "encoded-kubeconfig",
    namespace: "shared",
    projectId: "project-a",
  };
  await fetchAssistantSession(credentials);
  await fetchAssistantThreads(credentials);
  await fetchAssistantThreadMessages("chat-1", credentials);

  assert.deepEqual(requestedUrls, [
    "/api/chat/session?namespace=shared&projectId=project-a",
    "/api/chat/threads?namespace=shared&projectId=project-a",
    "/api/chat/messages?chatId=chat-1&namespace=shared&projectId=project-a",
  ]);
  assert.deepEqual(appTokenHeaders, ["app-token", "app-token", "app-token"]);
});

test("workspace conversation requests omit projectId from the scope query", async () => {
  const requestedUrls: string[] = [];
  globalThis.fetch = ((input: string | URL | Request) => {
    requestedUrls.push(String(input));
    return Promise.resolve(
      Response.json({
        chatId: "workspace-chat",
        freeTier: { billing: "user", limit: 0, remaining: 0 },
        messages: [],
        threads: [],
      })
    );
  }) as typeof fetch;

  await fetchAssistantSession({
    appToken: "app-token",
    kubeconfig: "encoded-kubeconfig",
    namespace: "shared",
  });

  assert.deepEqual(requestedUrls, ["/api/chat/session?namespace=shared"]);
});
