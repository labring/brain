import "server-only";

import { generateId } from "ai";

import { getFreeTierSnapshot, isSystemOpenAiConfigured } from "./free-tier";
import { assistantConversationRepository } from "./repository";
import { createAssistantConversationService } from "./service-core";
import { deriveThreadTitle, placeholderThreadTitle } from "./title";

const service = createAssistantConversationService({
  generateChatId: generateId,
  getFreeChatTurns: getFreeTierSnapshot,
  isSystemModelConfigured: isSystemOpenAiConfigured,
  placeholderTitle: placeholderThreadTitle,
  repository: assistantConversationRepository,
  titleThread: deriveThreadTitle,
});

export const appendMessageForOwner = service.appendMessage;
export const bootstrapAssistantSession = service.bootstrap;
export const ensureAssistantThreadForOwner = service.ensureThread;
export const listThreadsForOwner = service.listThreads;
export const loadMessagesForOwner = service.loadMessages;
export const maybeAutoTitleThread = service.maybeAutoTitle;
