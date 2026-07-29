import assert from "node:assert/strict";
import { test } from "node:test";

import type { AssistantConversationRepository } from "./repository-core";
import { createAssistantConversationService } from "./service-core";

type ServiceRepository = Pick<
  AssistantConversationRepository,
  | "ensureThreadForOwner"
  | "selectMessagesByOwner"
  | "selectThreadByOwner"
  | "selectThreadsByOwner"
  | "updateThreadAiTitleOnceForOwner"
>;

test("first-message creation uses the verified owner and continuing cannot re-key it", async () => {
  const owners = new Map<string, { namespace: string; userUid: string }>();
  const repository = {
    ensureThreadForOwner: (input) => {
      if (!owners.has(input.id)) {
        owners.set(input.id, input.owner);
      }
      return Promise.resolve(
        owners.get(input.id)?.namespace === input.owner.namespace &&
          owners.get(input.id)?.userUid === input.owner.userUid
      );
    },
    selectThreadByOwner: (chatId, owner) =>
      Promise.resolve(
        owners.get(chatId)?.namespace === owner.namespace &&
          owners.get(chatId)?.userUid === owner.userUid
          ? {
              createdAt: new Date("2026-07-21T00:00:00.000Z"),
              id: chatId,
              namespace: owner.namespace,
              title: "Chat",
              titleAiGenerated: false,
              updatedAt: new Date("2026-07-21T00:00:00.000Z"),
              workspaceActor: owner.userUid,
            }
          : null
      ),
    selectThreadsByOwner: () => Promise.resolve([]),
    selectMessagesByOwner: () => Promise.resolve(null),
    updateThreadAiTitleOnceForOwner: () => Promise.resolve(false),
  } satisfies ServiceRepository;
  const service = createAssistantConversationService({
    generateChatId: () => "generated-chat",
    getFreeChatTurns: () => Promise.resolve({ limit: 10, remaining: 10 }),
    isSystemModelConfigured: () => true,
    placeholderTitle: () => "Chat",
    repository,
    titleThread: () => Promise.resolve("Generated title"),
  });
  const alice = { namespace: "shared", userUid: "alice-cr" };
  const bob = { namespace: "shared", userUid: "bob-cr" };

  const draft = await service.bootstrap(alice);

  assert.equal(draft.chatId, "generated-chat");
  assert.deepEqual(draft.threads, []);
  assert.equal(owners.size, 0);
  assert.equal(await service.ensureThread(draft.chatId, alice), true);
  assert.equal(await service.ensureThread(draft.chatId, bob), false);
  assert.deepEqual(owners.get(draft.chatId), alice);
});

test("Free Chat Turns remain a namespace allowance instead of an actor allowance", async () => {
  const freeTierKeys: string[] = [];
  const repository = {
    ensureThreadForOwner: () => Promise.resolve(true),
    selectMessagesByOwner: () => Promise.resolve([]),
    selectThreadByOwner: () => Promise.resolve(null),
    selectThreadsByOwner: (owner) =>
      Promise.resolve([
        {
          createdAt: new Date("2026-07-21T00:00:00.000Z"),
          id: `${owner.userUid}-chat`,
          namespace: owner.namespace,
          title: "Chat",
          titleAiGenerated: false,
          updatedAt: new Date("2026-07-21T00:00:00.000Z"),
          workspaceActor: owner.userUid,
        },
      ]),
    updateThreadAiTitleOnceForOwner: () => Promise.resolve(false),
  } satisfies ServiceRepository;
  const service = createAssistantConversationService({
    generateChatId: () => "generated-chat",
    getFreeChatTurns: (namespace) => {
      freeTierKeys.push(namespace);
      return Promise.resolve({ limit: 10, remaining: 6 });
    },
    isSystemModelConfigured: () => true,
    placeholderTitle: () => "Chat",
    repository,
    titleThread: () => Promise.resolve("Generated title"),
  });

  const alice = await service.bootstrap({
    namespace: "shared",
    userUid: "alice-cr",
  });
  const bob = await service.bootstrap({
    namespace: "shared",
    userUid: "bob-cr",
  });

  assert.deepEqual(freeTierKeys, ["shared", "shared"]);
  assert.deepEqual(alice.freeTier, bob.freeTier);
  assert.deepEqual(alice.freeTier, {
    billing: "free",
    limit: 10,
    remaining: 6,
  });
});

test("automatic titling cannot read or rename another actor's conversation", async () => {
  const titledOwners: string[] = [];
  let generatedTitles = 0;
  let titleAbortSignal: AbortSignal | undefined;
  const bobThread = {
    createdAt: new Date("2026-07-21T00:00:00.000Z"),
    id: "bob-chat",
    namespace: "shared",
    title: "Chat",
    titleAiGenerated: false,
    updatedAt: new Date("2026-07-21T00:00:00.000Z"),
    workspaceActor: "bob-cr",
  };
  const repository = {
    ensureThreadForOwner: () => Promise.resolve(true),
    selectMessagesByOwner: (owner, chatId) =>
      Promise.resolve(
        owner.userUid === "bob-cr" && chatId === "bob-chat"
          ? [
              {
                id: "bob-message",
                role: "user" as const,
                parts: [{ type: "text" as const, text: "Bob content" }],
              },
            ]
          : null
      ),
    selectThreadByOwner: (chatId, owner) =>
      Promise.resolve(
        owner.userUid === "bob-cr" && chatId === "bob-chat" ? bobThread : null
      ),
    selectThreadsByOwner: () => Promise.resolve([]),
    updateThreadAiTitleOnceForOwner: (owner) => {
      titledOwners.push(owner.userUid);
      return Promise.resolve(true);
    },
  } satisfies ServiceRepository;
  const service = createAssistantConversationService({
    generateChatId: () => "generated-chat",
    getFreeChatTurns: () => Promise.resolve({ limit: 10, remaining: 10 }),
    isSystemModelConfigured: () => true,
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
    owner: { namespace: "shared", userUid: "alice-cr" },
  });
  await service.maybeAutoTitle({
    abortSignal: titleAbortController.signal,
    chatId: "bob-chat",
    languageModel: {} as never,
    owner: { namespace: "shared", userUid: "bob-cr" },
  });

  assert.equal(generatedTitles, 1);
  assert.equal(titleAbortSignal, titleAbortController.signal);
  assert.deepEqual(titledOwners, ["bob-cr"]);
});
