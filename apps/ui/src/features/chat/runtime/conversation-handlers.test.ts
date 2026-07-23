import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssistantThreadDTO } from "../persistence/types";
import {
  type AssistantConversationHandlerDependencies,
  createAssistantConversationHandlers,
} from "./conversation-handlers";

function jwt(subject: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: subject })).toString(
    "base64url"
  );
  return `${header}.${payload}.test-signature`;
}

function encodedKubeconfig(namespace: string, workspaceActor: string): string {
  return encodeURIComponent(`
apiVersion: v1
clusters:
  - name: cluster
    cluster:
      server: https://example.test
contexts:
  - name: current
    context:
      cluster: cluster
      namespace: ${namespace}
      user: active-user
current-context: current
users:
  - name: active-user
    user:
      token: ${jwt(`system:serviceaccount:user-system:${workspaceActor}`)}
`);
}

function authorizedRequest(path: string, workspaceActor: string): Request {
  return new Request(`https://brain.test${path}`, {
    headers: {
      Authorization: `Bearer ${encodedKubeconfig("shared", workspaceActor)}`,
    },
  });
}

function handlerDependencies(
  overrides: Partial<AssistantConversationHandlerDependencies> = {}
): AssistantConversationHandlerDependencies {
  return {
    bootstrap: () => Promise.reject(new Error("not used")),
    list: () => Promise.resolve([]),
    read: () => Promise.resolve(null),
    verify: () => Promise.resolve({ ok: true }),
    ...overrides,
  };
}

test("conversation handlers expose message reads without an unfenced write handler", () => {
  const handlers = createAssistantConversationHandlers(handlerDependencies());

  assert.equal(typeof handlers.messagesGet, "function");
  assert.equal("messagesPost" in handlers, false);
});

test("conversation listing ignores a spoofed user id and returns only the verified actor's threads", async () => {
  const threads = new Map<string, AssistantThreadDTO[]>([
    [
      "shared:alice-cr",
      [
        {
          id: "alice-chat",
          namespace: "shared",
          title: "Alice private thread",
          updatedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
    ],
    [
      "shared:bob-cr",
      [
        {
          id: "bob-chat",
          namespace: "shared",
          title: "Bob private thread",
          updatedAt: "2026-07-21T00:00:00.000Z",
        },
      ],
    ],
  ]);
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      list: (owner) =>
        Promise.resolve(
          threads.get(`${owner.namespace}:${owner.workspaceActor}`) ?? []
        ),
    })
  );

  const response = await handlers.threads(
    authorizedRequest(
      "/api/chat/threads?namespace=shared&userId=bob-cr",
      "alice-cr"
    )
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    threads: threads.get("shared:alice-cr"),
  });
});

test("conversation bootstrap is scoped to the verified actor", async () => {
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      bootstrap: (owner) =>
        Promise.resolve({
          chatId: `${owner.workspaceActor}-chat`,
          freeTier: { billing: "free", limit: 10, remaining: 7 },
          messages: [
            {
              id: `${owner.workspaceActor}-message`,
              role: "assistant",
              parts: [
                { type: "text", text: `${owner.workspaceActor} content` },
              ],
            },
          ],
          threads: [],
        }),
    })
  );

  const response = await handlers.session(
    authorizedRequest(
      "/api/chat/session?namespace=shared&userId=bob-cr",
      "alice-cr"
    )
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    chatId: "alice-cr-chat",
    freeTier: { billing: "free", limit: 10, remaining: 7 },
    messages: [
      {
        id: "alice-cr-message",
        role: "assistant",
        parts: [{ type: "text", text: "alice-cr content" }],
      },
    ],
    threads: [],
  });
});

test("reading another member's conversation is indistinguishable from a missing conversation", async () => {
  const privateMessages = new Map([
    [
      "shared:bob-cr:bob-chat",
      [
        {
          id: "bob-secret-message",
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: "Bob's private content" }],
        },
      ],
    ],
  ]);
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      read: (owner, chatId) =>
        Promise.resolve(
          privateMessages.get(
            `${owner.namespace}:${owner.workspaceActor}:${chatId}`
          ) ?? null
        ),
    })
  );

  const foreign = await handlers.messagesGet(
    authorizedRequest(
      "/api/chat/messages?namespace=shared&chatId=bob-chat",
      "alice-cr"
    )
  );
  const missing = await handlers.messagesGet(
    authorizedRequest(
      "/api/chat/messages?namespace=shared&chatId=missing-chat",
      "alice-cr"
    )
  );

  assert.equal(foreign.status, 404);
  assert.equal(missing.status, 404);
  const foreignBody = await foreign.json();
  const missingBody = await missing.json();
  assert.deepEqual(foreignBody, missingBody);
  assert.deepEqual(missingBody, {
    error: "Assistant conversation not found.",
  });
});

test("a cross-namespace conversation request is forbidden before storage access", async () => {
  let listed = false;
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      list: () => {
        listed = true;
        return Promise.resolve([]);
      },
    })
  );

  const response = await handlers.threads(
    authorizedRequest(
      "/api/chat/threads?namespace=another-workspace",
      "alice-cr"
    )
  );

  assert.equal(response.status, 403);
  assert.equal(listed, false);
});
