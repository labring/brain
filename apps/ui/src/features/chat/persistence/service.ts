import "server-only";

import { generateId, type UIMessage } from "ai";

import {
  type AssistantMessagePartsReplacement,
  adoptLegacyThreadsForActor,
  assistantConversationRepository,
  commitChatMessagesIfLeaseOwned as commitRepositoryChatMessagesIfLeaseOwned,
  isChatStreamLeaseMessageId,
  persistAssistantMessageIfLeaseOwned,
  type ChatStreamLease as RepositoryChatStreamLease,
  releaseChatStreamLease,
  renewChatStreamLease,
  replaceAssistantMessagePartsIfUnchanged,
  tryAcquireChatStreamLease,
} from "./repository";
import { createAssistantConversationService } from "./service-core";
import { deriveThreadTitle, placeholderThreadTitle } from "./title";
import {
  type AssistantConversationScope,
  normalizeAssistantNamespace,
  type VerifiedAssistantConversationActor,
} from "./types";

const service = createAssistantConversationService({
  generateChatId: generateId,
  placeholderTitle: placeholderThreadTitle,
  repository: assistantConversationRepository,
  titleThread: deriveThreadTitle,
});

export type { ChatStreamLease } from "./repository";

function normalizedScope(
  scope: AssistantConversationScope
): AssistantConversationScope {
  const owner = {
    namespace: normalizeAssistantNamespace(scope.namespace),
    userUid: scope.userUid,
  };
  if (scope.kind === "workspace") {
    return { ...owner, kind: "workspace" };
  }
  const projectId = scope.projectId.trim();
  if (projectId === "") {
    throw new Error("assistant project id is required");
  }
  return { ...owner, kind: "project", projectId };
}

export const bootstrapAssistantSession = service.bootstrap;
export const ensureAssistantThreadForOwner = service.ensureThread;
export const listThreadsForOwner = service.listThreads;
export const loadMessagesForOwner = service.loadMessages;
export const maybeAutoTitleThread = service.maybeAutoTitle;

export function isReservedChatMessageId(messageId: string): boolean {
  return isChatStreamLeaseMessageId(messageId);
}

/**
 * Lazy re-key (ADR-0059): a conversation entry request that passed the token
 * checks adopts the actor's legacy `(namespace, crName)` rows to the proven
 * uid. Idempotent — repeat requests are no-ops.
 */
export function adoptLegacyAssistantConversationsForActor(
  actor: VerifiedAssistantConversationActor
): Promise<void> {
  return adoptLegacyThreadsForActor({
    legacyWorkspaceActor: actor.legacyWorkspaceActor,
    owner: {
      namespace: normalizeAssistantNamespace(actor.owner.namespace),
      userUid: actor.owner.userUid,
    },
  });
}

export function acquireChatStreamLease(
  chatId: string,
  scopeRaw: AssistantConversationScope
): Promise<RepositoryChatStreamLease | null> {
  const scope = normalizedScope(scopeRaw);
  return tryAcquireChatStreamLease({ chatId, scope });
}

export function releaseOwnedChatStreamLease(
  lease: RepositoryChatStreamLease
): Promise<boolean> {
  return releaseChatStreamLease(lease);
}

export function renewOwnedChatStreamLease(
  lease: RepositoryChatStreamLease
): Promise<RepositoryChatStreamLease | null> {
  return renewChatStreamLease(lease);
}

export function persistAssistantResponseIfLeaseOwned(input: {
  lease: RepositoryChatStreamLease;
  message: UIMessage;
}): Promise<boolean> {
  return persistAssistantMessageIfLeaseOwned(input);
}

export function commitChatMessagesIfLeaseOwned(input: {
  lease: RepositoryChatStreamLease;
  replacements: AssistantMessagePartsReplacement[];
  upsertMessage?: UIMessage;
}): Promise<RepositoryChatStreamLease | null> {
  return commitRepositoryChatMessagesIfLeaseOwned(input);
}

/** Replace a pending assistant message exactly once from a known parts snapshot. */
export function replacePendingAssistantMessage(input: {
  chatId: string;
  expectedParts: UIMessage["parts"];
  messageId: string;
  scope: AssistantConversationScope;
  replacementParts: UIMessage["parts"];
}): Promise<boolean> {
  return replaceAssistantMessagePartsIfUnchanged({
    ...input,
    scope: normalizedScope(input.scope),
  });
}
