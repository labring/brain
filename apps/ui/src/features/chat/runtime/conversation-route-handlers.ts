import "server-only";

import {
  adoptLegacyAssistantConversationsForActor,
  bootstrapAssistantSession,
  listThreadsForOwner,
  loadMessagesForOwner,
} from "../persistence/service";
import { createAssistantConversationHandlers } from "./conversation-handlers";

export const assistantConversationRouteHandlers =
  createAssistantConversationHandlers({
    adoptLegacyConversations: adoptLegacyAssistantConversationsForActor,
    bootstrap: bootstrapAssistantSession,
    list: listThreadsForOwner,
    read: (owner, chatId) => loadMessagesForOwner(chatId, owner),
  });
