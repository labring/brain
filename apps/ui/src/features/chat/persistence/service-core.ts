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
  type VerifiedAssistantConversationActor,
} from "./types";

type ChatTitleModel = Parameters<typeof generateText>[0]["model"];
type AssistantConversationServiceRepository = Pick<
  AssistantConversationRepository,
  | "ensureThreadForOwner"
  | "selectMessagesByOwner"
  | "selectThreadByOwner"
  | "selectThreadsByOwner"
  | "updateThreadAiTitleOnceForOwner"
>;

export interface AssistantConversationServiceDependencies {
  generateChatId: () => string;
  placeholderTitle: () => string;
  repository: AssistantConversationServiceRepository;
  titleThread: (input: {
    abortSignal?: AbortSignal;
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
    userUid: owner.userUid,
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
    // Chat Billing Posture deliberately stays out of conversation
    // persistence: the session handler resolves it separately (ADR-0065's
    // live trial judgment) and merges it into the wire payload.
    bootstrap: async (
      ownerRaw: AssistantConversationOwner
    ): Promise<Omit<AssistantSessionPayload, "freeTier">> => {
      const owner = normalizedOwner(ownerRaw);
      const rows = await repository.selectThreadsByOwner(owner);
      const latest = rows[0];
      if (latest === undefined) {
        return {
          chatId: dependencies.generateChatId(),
          messages: [],
          threads: [],
        };
      }
      return {
        chatId: latest.id,
        messages:
          (await repository.selectMessagesByOwner(owner, latest.id)) ?? [],
        threads: toThreadDTOs(rows),
      };
    },

    ensureThread: (
      chatId: string,
      actor: VerifiedAssistantConversationActor
    ): Promise<boolean> =>
      repository.ensureThreadForOwner({
        actor: {
          legacyWorkspaceActor: actor.legacyWorkspaceActor,
          owner: normalizedOwner(actor.owner),
        },
        id: chatId,
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
      abortSignal?: AbortSignal;
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
        abortSignal: input.abortSignal,
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
