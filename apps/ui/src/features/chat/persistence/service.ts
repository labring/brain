import "server-only";

import { generateId, type UIMessage } from "ai";

import { getFreeTierSnapshot, isSystemOpenAiConfigured } from "./free-tier";
import {
  type AssistantMessagePartsReplacement,
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
} from "./types";

const service = createAssistantConversationService({
  generateChatId: generateId,
  getFreeChatTurns: getFreeTierSnapshot,
  isSystemModelConfigured: isSystemOpenAiConfigured,
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
    workspaceActor: owner.workspaceActor,
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
