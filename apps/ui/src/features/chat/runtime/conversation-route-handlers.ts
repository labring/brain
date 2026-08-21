import "server-only";

import {
  getFreeTierSnapshot,
  resolveFreeTierPosture,
} from "../persistence/free-tier";
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
    freeTurnsUsage: getFreeTierSnapshot,
    list: listThreadsForOwner,
    read: (owner, chatId) => loadMessagesForOwner(chatId, owner),
    resolveFreeTier: ({ actor, cookieHeader }) =>
      resolveFreeTierPosture({
        accountUserId: actor.accountUserId ?? null,
        cookieHeader,
        namespace: actor.owner.namespace,
        userUid: actor.owner.userUid,
      }),
  });
