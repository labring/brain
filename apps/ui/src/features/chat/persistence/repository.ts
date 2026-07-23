import "server-only";

import { getAssistantDb } from "./db";
import {
  createAssistantConversationRepository,
  isChatStreamLeaseMessageId as isChatStreamLeaseMessageIdFromCore,
} from "./repository-core";

export type {
  AssistantConversationRepository,
  AssistantMessagePartsReplacement,
  ChatStreamLease,
  ThreadRow,
} from "./repository-core";

export function isChatStreamLeaseMessageId(messageId: string): boolean {
  return isChatStreamLeaseMessageIdFromCore(messageId);
}

export const assistantConversationRepository =
  createAssistantConversationRepository(getAssistantDb);

export const commitChatMessagesIfLeaseOwned =
  assistantConversationRepository.commitChatMessagesIfLeaseOwned;
export const persistAssistantMessageIfLeaseOwned =
  assistantConversationRepository.persistAssistantMessageIfLeaseOwned;
export const releaseChatStreamLease =
  assistantConversationRepository.releaseChatStreamLease;
export const renewChatStreamLease =
  assistantConversationRepository.renewChatStreamLease;
export const replaceAssistantMessagePartsIfUnchanged =
  assistantConversationRepository.replaceAssistantMessagePartsIfUnchanged;
export const tryAcquireChatStreamLease =
  assistantConversationRepository.tryAcquireChatStreamLease;
