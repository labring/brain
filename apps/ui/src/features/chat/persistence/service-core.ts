import type { generateText, UIMessage } from "ai";

import type {
  AssistantConversationRepository,
  ThreadRow,
} from "./repository-core";
import {
  type AssistantConversationScope,
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

function normalizedScope(
  scope: AssistantConversationScope
): AssistantConversationScope {
  const projectId = scope.projectId.trim();
  if (projectId === "") {
    throw new Error("assistant project id is required");
  }
  return {
    namespace: normalizeAssistantNamespace(scope.namespace),
    projectId,
    userUid: scope.userUid,
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
      scopeRaw: AssistantConversationScope
    ): Promise<Omit<AssistantSessionPayload, "freeTier">> => {
      const scope = normalizedScope(scopeRaw);
      const rows = await repository.selectThreadsByOwner(scope);
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
          (await repository.selectMessagesByOwner(scope, latest.id)) ?? [],
        threads: toThreadDTOs(rows),
      };
    },

    ensureThread: (
      chatId: string,
      actor: VerifiedAssistantConversationActor,
      projectId: string
    ): Promise<boolean> => {
      const normalizedProjectId = projectId.trim();
      if (normalizedProjectId === "") {
        throw new Error("assistant project id is required");
      }
      return repository.ensureThreadForOwner({
        actor: {
          legacyWorkspaceActor: actor.legacyWorkspaceActor,
          owner: {
            namespace: normalizeAssistantNamespace(actor.owner.namespace),
            userUid: actor.owner.userUid,
          },
        },
        id: chatId,
        projectId: normalizedProjectId,
        title: dependencies.placeholderTitle(),
      });
    },

    listThreads: async (
      scope: AssistantConversationScope
    ): Promise<AssistantThreadDTO[]> =>
      toThreadDTOs(
        await repository.selectThreadsByOwner(normalizedScope(scope))
      ),

    loadMessages: (
      chatId: string,
      scope: AssistantConversationScope
    ): Promise<UIMessage[] | null> =>
      repository.selectMessagesByOwner(normalizedScope(scope), chatId),

    maybeAutoTitle: async (input: {
      abortSignal?: AbortSignal;
      chatId: string;
      languageModel: ChatTitleModel;
      scope: AssistantConversationScope;
      projectName?: string;
    }): Promise<void> => {
      const scope = normalizedScope(input.scope);
      const thread = await repository.selectThreadByOwner(input.chatId, scope);
      if (thread == null || thread.titleAiGenerated) {
        return;
      }
      const messages = await repository.selectMessagesByOwner(
        scope,
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
        scope,
        input.chatId,
        title
      );
    },
  };
}
