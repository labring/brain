import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssistantConversationRepository } from "./repository-core";
import { createAssistantConversationService } from "./service-core";
import type { AssistantConversationScope } from "./types";

type ServiceRepository = Pick<
  AssistantConversationRepository,
  | "ensureThreadForOwner"
  | "selectMessagesByOwner"
  | "selectThreadByOwner"
  | "selectThreadsByOwner"
  | "updateThreadAiTitleOnceForOwner"
>;

const PROJECT_ID_REQUIRED_PATTERN = /assistant project id is required/;

test("first-message creation pins the verified owner and project scope", async () => {
  const scopes = new Map<string, AssistantConversationScope>();
  const repository = {
    ensureThreadForOwner: (input) => {
      const requested: AssistantConversationScope = {
        ...input.actor.owner,
        ...input.target,
      };
      if (!scopes.has(input.id)) {
        scopes.set(input.id, requested);
      }
      const stored = scopes.get(input.id);
      return Promise.resolve(
        stored?.namespace === requested.namespace &&
          stored?.kind === requested.kind &&
          (stored?.kind !== "project" ||
            (requested.kind === "project" &&
              stored.projectId === requested.projectId)) &&
          stored?.userUid === requested.userUid
      );
    },
    selectThreadByOwner: (chatId, scope) => {
      const stored = scopes.get(chatId);
      return Promise.resolve(
        stored?.namespace === scope.namespace &&
          stored?.kind === scope.kind &&
          (stored?.kind !== "project" ||
            (scope.kind === "project" &&
              stored.projectId === scope.projectId)) &&
          stored?.userUid === scope.userUid
          ? {
              createdAt: new Date("2026-07-21T00:00:00.000Z"),
              id: chatId,
              namespace: scope.namespace,
              projectId: scope.kind === "project" ? scope.projectId : null,
              scopeKind: scope.kind,
              title: "Chat",
              titleAiGenerated: false,
              updatedAt: new Date("2026-07-21T00:00:00.000Z"),
              workspaceActor: scope.userUid,
            }
          : null
      );
    },
    selectThreadsByOwner: () => Promise.resolve([]),
    selectMessagesByOwner: () => Promise.resolve(null),
    updateThreadAiTitleOnceForOwner: () => Promise.resolve(false),
  } satisfies ServiceRepository;
  const service = createAssistantConversationService({
    generateChatId: () => "generated-chat",
    placeholderTitle: () => "Chat",
    repository,
    titleThread: () => Promise.resolve("Generated title"),
  });
  const alice = {
    kind: "project" as const,
    namespace: "shared",
    projectId: "project-a",
    userUid: "alice-cr",
  };
  const aliceOtherProject = { ...alice, projectId: "project-b" };
  const bob = {
    kind: "project" as const,
    namespace: "shared",
    projectId: "project-a",
    userUid: "bob-cr",
  };
  const aliceActor = {
    legacyWorkspaceActor: "alicecr1",
    owner: { namespace: alice.namespace, userUid: alice.userUid },
  };
  const bobActor = {
    legacyWorkspaceActor: "bobcrnm1",
    owner: { namespace: bob.namespace, userUid: bob.userUid },
  };

  const draft = await service.bootstrap(alice);

  assert.equal(draft.chatId, "generated-chat");
  assert.deepEqual(draft.threads, []);
  assert.equal(scopes.size, 0);
  assert.equal(
    await service.ensureThread(draft.chatId, aliceActor, {
      kind: "project",
      projectId: alice.projectId,
    }),
    true
  );
  assert.equal(
    await service.ensureThread(draft.chatId, bobActor, {
      kind: "project",
      projectId: bob.projectId,
    }),
    false
  );
  assert.equal(
    await service.loadMessages(draft.chatId, aliceOtherProject),
    null
  );
  assert.deepEqual(scopes.get(draft.chatId), alice);
});

test("automatic titling cannot cross actor or project scope", async () => {
  const titledScopes: AssistantConversationScope[] = [];
  let generatedTitles = 0;
  let titleAbortSignal: AbortSignal | undefined;
  const bobScope = {
    kind: "project" as const,
    namespace: "shared",
    projectId: "project-b",
    userUid: "bob-cr",
  };
  const bobThread = {
    createdAt: new Date("2026-07-21T00:00:00.000Z"),
    id: "bob-chat",
    namespace: bobScope.namespace,
    projectId: bobScope.projectId,
    scopeKind: "project" as const,
    title: "Chat",
    titleAiGenerated: false,
    updatedAt: new Date("2026-07-21T00:00:00.000Z"),
    workspaceActor: bobScope.userUid,
  };
  const isBobScope = (scope: AssistantConversationScope) =>
    scope.namespace === bobScope.namespace &&
    scope.kind === "project" &&
    scope.projectId === bobScope.projectId &&
    scope.userUid === bobScope.userUid;
  const repository = {
    ensureThreadForOwner: () => Promise.resolve(true),
    selectMessagesByOwner: (scope, chatId) =>
      Promise.resolve(
        isBobScope(scope) && chatId === "bob-chat"
          ? [
              {
                id: "bob-message",
                role: "user" as const,
                parts: [{ type: "text" as const, text: "Bob content" }],
              },
            ]
          : null
      ),
    selectThreadByOwner: (chatId, scope) =>
      Promise.resolve(
        isBobScope(scope) && chatId === "bob-chat" ? bobThread : null
      ),
    selectThreadsByOwner: () => Promise.resolve([]),
    updateThreadAiTitleOnceForOwner: (scope) => {
      titledScopes.push(scope);
      return Promise.resolve(true);
    },
  } satisfies ServiceRepository;
  const service = createAssistantConversationService({
    generateChatId: () => "generated-chat",
    placeholderTitle: () => "Chat",
    repository,
    titleThread: (input) => {
      generatedTitles += 1;
      titleAbortSignal = input.abortSignal;
      return Promise.resolve("Private title");
    },
  });
  const titleAbortController = new AbortController();

  await service.maybeAutoTitle({
    chatId: "bob-chat",
    languageModel: {} as never,
    scope: { ...bobScope, projectId: "project-a" },
  });
  await service.maybeAutoTitle({
    abortSignal: titleAbortController.signal,
    chatId: "bob-chat",
    languageModel: {} as never,
    scope: bobScope,
  });

  assert.equal(generatedTitles, 1);
  assert.equal(titleAbortSignal, titleAbortController.signal);
  assert.deepEqual(titledScopes, [bobScope]);
});

test("conversation service fails closed on an empty project scope", async () => {
  let repositoryRead = false;
  const repository = {
    ensureThreadForOwner: () => {
      repositoryRead = true;
      return Promise.resolve(true);
    },
    selectMessagesByOwner: () => {
      repositoryRead = true;
      return Promise.resolve(null);
    },
    selectThreadByOwner: () => {
      repositoryRead = true;
      return Promise.resolve(null);
    },
    selectThreadsByOwner: () => {
      repositoryRead = true;
      return Promise.resolve([]);
    },
    updateThreadAiTitleOnceForOwner: () => {
      repositoryRead = true;
      return Promise.resolve(false);
    },
  } satisfies ServiceRepository;
  const service = createAssistantConversationService({
    generateChatId: () => "generated-chat",
    placeholderTitle: () => "Chat",
    repository,
    titleThread: () => Promise.resolve("Generated title"),
  });
  const emptyProjectScope = {
    kind: "project" as const,
    namespace: "shared",
    projectId: "   ",
    userUid: "alice-cr",
  };

  await assert.rejects(
    service.bootstrap(emptyProjectScope),
    PROJECT_ID_REQUIRED_PATTERN
  );
  await assert.rejects(
    async () =>
      service.ensureThread(
        "chat-a",
        { legacyWorkspaceActor: "alicecr1", owner: emptyProjectScope },
        { kind: "project", projectId: emptyProjectScope.projectId }
      ),
    PROJECT_ID_REQUIRED_PATTERN
  );
  assert.equal(repositoryRead, false);
});
