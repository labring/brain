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
  type AssistantConversationOwner,
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

function normalizedOwner(
  owner: AssistantConversationOwner
): AssistantConversationOwner {
  return {
    namespace: normalizeAssistantNamespace(owner.namespace),
    userUid: owner.userUid,
  };
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
    owner: normalizedOwner(actor.owner),
  });
}

export function acquireChatStreamLease(
  chatId: string,
  ownerRaw: AssistantConversationOwner
): Promise<RepositoryChatStreamLease | null> {
  const owner = normalizedOwner(ownerRaw);
  return tryAcquireChatStreamLease({ chatId, owner });
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
  owner: AssistantConversationOwner;
  replacementParts: UIMessage["parts"];
}): Promise<boolean> {
  return replaceAssistantMessagePartsIfUnchanged({
    ...input,
    owner: normalizedOwner(input.owner),
  });
}
