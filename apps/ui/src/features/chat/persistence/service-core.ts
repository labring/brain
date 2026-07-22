import type { generateText, UIMessage } from "ai";

import type {
  AssistantConversationRepository,
  ThreadRow,
} from "./repository-core";
import {
  type AssistantConversationOwner,
  type AssistantSessionPayload,
  type AssistantThreadDTO,
  normalizeAssistantNamespace,
} from "./types";

type ChatTitleModel = Parameters<typeof generateText>[0]["model"];

export interface AssistantConversationServiceDependencies {
  generateChatId: () => string;
  getFreeChatTurns: (namespace: string) => Promise<{
    limit: number;
    remaining: number;
  }>;
  isSystemModelConfigured: () => boolean;
  placeholderTitle: () => string;
  repository: AssistantConversationRepository;
  titleThread: (input: {
    languageModel: ChatTitleModel;
    messages: UIMessage[];
    projectName?: string;
  }) => Promise<string>;
}

function normalizedOwner(
  owner: AssistantConversationOwner
): AssistantConversationOwner {
  return {
    namespace: normalizeAssistantNamespace(owner.namespace),
    workspaceActor: owner.workspaceActor,
  };
}

function toThreadDTO(row: ThreadRow): AssistantThreadDTO {
  return {
    id: row.id,
    namespace: row.namespace,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toThreadDTOs(rows: ThreadRow[]): AssistantThreadDTO[] {
  return rows.map(toThreadDTO);
}

export function createAssistantConversationService(
  dependencies: AssistantConversationServiceDependencies
) {
  const repository = dependencies.repository;
  return {
    appendMessage: (
      chatId: string,
      message: UIMessage,
      owner: AssistantConversationOwner
    ): Promise<boolean> =>
      repository.upsertMessageForOwner(normalizedOwner(owner), chatId, message),

    bootstrap: async (
      ownerRaw: AssistantConversationOwner
    ): Promise<AssistantSessionPayload> => {
      const owner = normalizedOwner(ownerRaw);
      const rows = await repository.selectThreadsByOwner(owner);
      // Free Chat Turns deliberately remain keyed only by namespace (ADR 0056).
      const snapshot = await dependencies.getFreeChatTurns(owner.namespace);
      const freeChatTurns = {
        billing: (snapshot.remaining > 0 &&
        dependencies.isSystemModelConfigured()
          ? "free"
          : "user") as "free" | "user",
        remaining: snapshot.remaining,
        limit: snapshot.limit,
      };
      const latest = rows[0];
      if (latest === undefined) {
        return {
          chatId: dependencies.generateChatId(),
          messages: [],
          threads: [],
          freeTier: freeChatTurns,
        };
      }
      return {
        chatId: latest.id,
        messages:
          (await repository.selectMessagesByOwner(owner, latest.id)) ?? [],
        threads: toThreadDTOs(rows),
        freeTier: freeChatTurns,
      };
    },

    ensureThread: (
      chatId: string,
      owner: AssistantConversationOwner
    ): Promise<boolean> =>
      repository.ensureThreadForOwner({
        id: chatId,
        owner: normalizedOwner(owner),
        title: dependencies.placeholderTitle(),
      }),

    listThreads: async (
      owner: AssistantConversationOwner
    ): Promise<AssistantThreadDTO[]> =>
      toThreadDTOs(
        await repository.selectThreadsByOwner(normalizedOwner(owner))
      ),

    loadMessages: (
      chatId: string,
      owner: AssistantConversationOwner
    ): Promise<UIMessage[] | null> =>
      repository.selectMessagesByOwner(normalizedOwner(owner), chatId),

    maybeAutoTitle: async (input: {
      chatId: string;
      languageModel: ChatTitleModel;
      owner: AssistantConversationOwner;
      projectName?: string;
    }): Promise<void> => {
      const owner = normalizedOwner(input.owner);
      const thread = await repository.selectThreadByOwner(input.chatId, owner);
      if (thread == null || thread.titleAiGenerated) {
        return;
      }
      const messages = await repository.selectMessagesByOwner(
        owner,
        input.chatId
      );
      if (messages == null) {
        return;
      }
      const title = await dependencies.titleThread({
        languageModel: input.languageModel,
        messages,
        projectName: input.projectName,
      });
      await repository.updateThreadAiTitleOnceForOwner(
        owner,
        input.chatId,
        title
      );
    },
  };
}
