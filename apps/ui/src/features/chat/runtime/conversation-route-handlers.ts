import "server-only";

import {
  appendMessageForOwner,
  bootstrapAssistantSession,
  listThreadsForOwner,
  loadMessagesForOwner,
} from "../persistence/service";
import { createAssistantConversationHandlers } from "./conversation-handlers";

export const assistantConversationRouteHandlers =
  createAssistantConversationHandlers({
    append: (owner, chatId, message) =>
      appendMessageForOwner(chatId, message, owner),
    bootstrap: bootstrapAssistantSession,
    list: listThreadsForOwner,
    read: (owner, chatId) => loadMessagesForOwner(chatId, owner),
  });
