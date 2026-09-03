import assert from "node:assert/strict";
import { test } from "node:test";

import { SignJWT } from "jose";

import type {
  AssistantConversationScope,
  AssistantThreadDTO,
} from "../persistence/types";
import {
  type AssistantConversationHandlerDependencies,
  createAssistantConversationHandlers,
} from "./conversation-handlers";

const APP_TOKEN_SECRET = "cluster-shared-jwt-internal";
const APP_TOKEN_CONFIG = {
  secret: APP_TOKEN_SECRET,
};

function scopeLabel(scope: AssistantConversationScope): string {
  return scope.kind === "project" ? scope.projectId : "workspace";
}

function mintAppToken(crName: string, secret = APP_TOKEN_SECRET) {
  return new SignJWT({
    userCrName: crName,
    userUid: `${crName}-uid`,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(1_753_600_000)
    .sign(new TextEncoder().encode(secret));
}

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

async function authorizedRequest(
  path: string,
  workspaceActor: string,
  appToken?: string
): Promise<Request> {
  return new Request(`https://brain.test${path}`, {
    headers: {
      Authorization: `Bearer ${encodedKubeconfig("shared", workspaceActor)}`,
      "X-Sealos-App-Token": appToken ?? (await mintAppToken(workspaceActor)),
    },
  });
}

function handlerDependencies(
  overrides: Partial<AssistantConversationHandlerDependencies> = {}
): AssistantConversationHandlerDependencies {
  return {
    adoptLegacyConversations: () => Promise.resolve(),
    appTokenConfig: APP_TOKEN_CONFIG,
    bootstrap: () => Promise.reject(new Error("not used")),
    freeTurnsUsage: () => Promise.resolve({ limit: 5, remaining: 5, used: 0 }),
    list: () => Promise.resolve([]),
    observeFingerprint: () => Promise.resolve({ outcome: "match" }),
    read: () => Promise.resolve(null),
    resolveFreeTier: () =>
      Promise.resolve({ billing: "free" as const, limit: 5, remaining: 5 }),
    verify: () => Promise.resolve({ ok: true }),
    ...overrides,
  };
}

test("conversation handlers expose message reads without an unfenced write handler", () => {
  const handlers = createAssistantConversationHandlers(handlerDependencies());

  assert.equal(typeof handlers.messagesGet, "function");
  assert.equal("messagesPost" in handlers, false);
});

test("conversation listing keys the owner by the token-proven userUid, ignoring a spoofed user id", async () => {
  const threads = new Map<string, AssistantThreadDTO[]>([
    [
      "shared:alice-cr-uid:project-a",
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
      "shared:bob-cr-uid:project-a",
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
      list: (scope) =>
        Promise.resolve(
          threads.get(
            `${scope.namespace}:${scope.userUid}:${scopeLabel(scope)}`
          ) ?? []
        ),
    })
  );

  const response = await handlers.threads(
    await authorizedRequest(
      "/api/chat/threads?namespace=shared&projectId=project-a&userId=bob-cr",
      "alice-cr"
    )
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    threads: threads.get("shared:alice-cr-uid:project-a"),
  });
});

test("conversation handlers pass the requested project into every scoped read", async () => {
  const scopes: string[] = [];
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      bootstrap: (scope) => {
        scopes.push(`bootstrap:${scopeLabel(scope)}`);
        return Promise.resolve({ chatId: "draft", messages: [], threads: [] });
      },
      list: (scope) => {
        scopes.push(`list:${scopeLabel(scope)}`);
        return Promise.resolve([]);
      },
      read: (scope) => {
        scopes.push(`read:${scopeLabel(scope)}`);
        return Promise.resolve([]);
      },
    })
  );

  const requests: [string, (request: Request) => Promise<Response>][] = [
    [
      "/api/chat/session?namespace=shared&projectId=project-a",
      handlers.session,
    ],
    [
      "/api/chat/threads?namespace=shared&projectId=project-b",
      handlers.threads,
    ],
    [
      "/api/chat/messages?namespace=shared&projectId=project-c&chatId=chat-c",
      handlers.messagesGet,
    ],
  ];

  for (const [path, handler] of requests) {
    const response = await handler(await authorizedRequest(path, "alice-cr"));
    assert.equal(response.status, 200);
  }

  assert.deepEqual(scopes, [
    "bootstrap:project-a",
    "list:project-b",
    "read:project-c",
  ]);
});

test("conversation routes use workspace scope when project id is missing or empty", async () => {
  const scopes: string[] = [];
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      bootstrap: (scope) => {
        scopes.push(`bootstrap:${scopeLabel(scope)}`);
        return Promise.resolve({ chatId: "draft", messages: [], threads: [] });
      },
      list: (scope) => {
        scopes.push(`list:${scopeLabel(scope)}`);
        return Promise.resolve([]);
      },
      read: (scope) => {
        scopes.push(`read:${scopeLabel(scope)}`);
        return Promise.resolve([]);
      },
    })
  );
  const requests: [string, (request: Request) => Promise<Response>][] = [
    ["/api/chat/session?namespace=shared", handlers.session],
    ["/api/chat/threads?namespace=shared&projectId=%20", handlers.threads],
    ["/api/chat/messages?namespace=shared&chatId=chat-a", handlers.messagesGet],
  ];

  for (const [path, handler] of requests) {
    const response = await handler(await authorizedRequest(path, "alice-cr"));
    assert.equal(response.status, 200);
  }
  assert.deepEqual(scopes, [
    "bootstrap:workspace",
    "list:workspace",
    "read:workspace",
  ]);
});

test("every verified entry request adopts the actor's legacy conversations before reading them", async () => {
  const calls: string[] = [];
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      adoptLegacyConversations: (actor) => {
        calls.push(
          `adopt:${actor.legacyWorkspaceActor}->` +
            `${actor.owner.namespace}:${actor.owner.userUid}`
        );
        return Promise.resolve();
      },
      bootstrap: (scope) => {
        calls.push(
          `bootstrap:${scope.namespace}:${scope.userUid}:${scopeLabel(scope)}`
        );
        return Promise.resolve({
          chatId: "bootstrap-chat",
          messages: [],
          threads: [],
        });
      },
      list: (scope) => {
        calls.push(
          `list:${scope.namespace}:${scope.userUid}:${scopeLabel(scope)}`
        );
        return Promise.resolve([]);
      },
      read: (scope) => {
        calls.push(
          `read:${scope.namespace}:${scope.userUid}:${scopeLabel(scope)}`
        );
        return Promise.resolve([]);
      },
    })
  );

  const entries: [string, (request: Request) => Promise<Response>][] = [
    [
      "/api/chat/threads?namespace=shared&projectId=project-a",
      handlers.threads,
    ],
    [
      "/api/chat/session?namespace=shared&projectId=project-a",
      handlers.session,
    ],
    [
      "/api/chat/messages?namespace=shared&projectId=project-a&chatId=any-chat",
      handlers.messagesGet,
    ],
  ];
  for (const [path, handler] of entries) {
    const response = await handler(await authorizedRequest(path, "alice-cr"));
    assert.equal(response.status, 200);
  }

  assert.deepEqual(calls, [
    "adopt:alice-cr->shared:alice-cr-uid",
    "list:shared:alice-cr-uid:project-a",
    "adopt:alice-cr->shared:alice-cr-uid",
    "bootstrap:shared:alice-cr-uid:project-a",
    "adopt:alice-cr->shared:alice-cr-uid",
    "read:shared:alice-cr-uid:project-a",
  ]);
});

test("an adoption failure surfaces as unavailable persistence without a partial read", async () => {
  let listed = false;
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      adoptLegacyConversations: () =>
        Promise.reject(new Error("database unavailable")),
      list: () => {
        listed = true;
        return Promise.resolve([]);
      },
    })
  );

  const response = await handlers.threads(
    await authorizedRequest(
      "/api/chat/threads?namespace=shared&projectId=project-a",
      "alice-cr"
    )
  );

  assert.equal(response.status, 503);
  assert.equal(listed, false);
});

test("conversation bootstrap is scoped to the verified actor and carries the resolved posture", async () => {
  const postureActors: string[] = [];
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      bootstrap: (owner) =>
        Promise.resolve({
          chatId: `${owner.userUid}-chat`,
          messages: [
            {
              id: `${owner.userUid}-message`,
              role: "assistant",
              parts: [{ type: "text", text: `${owner.userUid} content` }],
            },
          ],
          threads: [],
        }),
      resolveFreeTier: ({ actor }) => {
        postureActors.push(`${actor.owner.namespace}:${actor.owner.userUid}`);
        return Promise.resolve({
          billing: "free" as const,
          limit: 10,
          remaining: 7,
        });
      },
    })
  );

  const response = await handlers.session(
    await authorizedRequest(
      "/api/chat/session?namespace=shared&projectId=project-a&userId=bob-cr",
      "alice-cr"
    )
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    chatId: "alice-cr-uid-chat",
    freeTier: { billing: "free", limit: 10, remaining: 7 },
    messages: [
      {
        id: "alice-cr-uid-message",
        role: "assistant",
        parts: [{ type: "text", text: "alice-cr-uid content" }],
      },
    ],
    threads: [],
  });
  assert.deepEqual(postureActors, ["shared:alice-cr-uid"]);
});

test("free-turns usage is keyed by the verified namespace and never judged", async () => {
  const usageKeys: string[] = [];
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      freeTurnsUsage: (namespace) => {
        usageKeys.push(namespace);
        return Promise.resolve({ limit: 5, remaining: 2, used: 3 });
      },
      resolveFreeTier: () => Promise.reject(new Error("not used")),
    })
  );

  const response = await handlers.freeTurns(
    await authorizedRequest("/api/chat/free-turns?namespace=shared", "alice-cr")
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { limit: 5, remaining: 2, used: 3 });
  assert.deepEqual(usageKeys, ["shared"]);
});

test("reading another member's conversation is indistinguishable from a missing conversation", async () => {
  const privateMessages = new Map([
    [
      "shared:bob-cr-uid:bob-chat",
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
            `${owner.namespace}:${owner.userUid}:${chatId}`
          ) ?? null
        ),
    })
  );

  const foreign = await handlers.messagesGet(
    await authorizedRequest(
      "/api/chat/messages?namespace=shared&projectId=project-a&chatId=bob-chat",
      "alice-cr"
    )
  );
  const missing = await handlers.messagesGet(
    await authorizedRequest(
      "/api/chat/messages?namespace=shared&projectId=project-a&chatId=missing-chat",
      "alice-cr"
    )
  );

  assert.equal(foreign.status, 404);
  assert.equal(missing.status, 404);
  const foreignBody = await foreign.json();
  const missingBody = await missing.json();
  assert.deepEqual(foreignBody, missingBody);
  assert.deepEqual(missingBody, {
    code: "assistant_conversation_not_found",
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
    await authorizedRequest(
      "/api/chat/threads?namespace=another-workspace&projectId=project-a",
      "alice-cr"
    )
  );

  assert.equal(response.status, 403);
  assert.equal(listed, false);
});

test("personal conversation routes return 401 without the app token header", async () => {
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
    new Request(
      "https://brain.test/api/chat/threads?namespace=shared&projectId=project-a",
      {
        headers: {
          Authorization: `Bearer ${encodedKubeconfig("shared", "alice-cr")}`,
        },
      }
    )
  );

  assert.equal(response.status, 401);
  assert.equal(listed, false);
});

test("an app token signed with the wrong secret is refused with 401", async () => {
  const handlers = createAssistantConversationHandlers(handlerDependencies());

  const response = await handlers.session(
    await authorizedRequest(
      "/api/chat/session?namespace=shared&projectId=project-a",
      "alice-cr",
      await mintAppToken("alice-cr", "attacker-secret")
    )
  );

  assert.equal(response.status, 401);
});

test("an app token bound to another actor is refused with 403", async () => {
  const handlers = createAssistantConversationHandlers(handlerDependencies());

  const response = await handlers.session(
    await authorizedRequest(
      "/api/chat/session?namespace=shared&projectId=project-a",
      "alice-cr",
      await mintAppToken("bob-cr")
    )
  );

  assert.equal(response.status, 403);
});

test("a binding superseded by an account merge is refused with 401 before any read", async () => {
  let listed = false;
  const handlers = createAssistantConversationHandlers(
    handlerDependencies({
      list: () => {
        listed = true;
        return Promise.resolve([]);
      },
      observeFingerprint: () =>
        Promise.resolve({
          observedMintedAt: 1_753_700_000,
          observedUserUid: "surviving-uid",
          outcome: "superseded",
        }),
    })
  );

  const response = await handlers.threads(
    await authorizedRequest(
      "/api/chat/threads?namespace=shared&projectId=project-a",
      "alice-cr"
    )
  );

  assert.equal(response.status, 401);
  assert.equal(listed, false);
});
