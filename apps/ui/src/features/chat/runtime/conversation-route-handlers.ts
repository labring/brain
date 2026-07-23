import "server-only";

import {
  bootstrapAssistantSession,
  listThreadsForOwner,
  loadMessagesForOwner,
} from "../persistence/service";
import { createAssistantConversationHandlers } from "./conversation-handlers";

export const assistantConversationRouteHandlers =
  createAssistantConversationHandlers({
    bootstrap: bootstrapAssistantSession,
    list: listThreadsForOwner,
    read: (owner, chatId) => loadMessagesForOwner(chatId, owner),
  });
