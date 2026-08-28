import "server-only";

import type { ChatDevMockHandler } from "../dev-fixtures";
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

type ConversationRouteHandler = (request: Request) => Promise<Response>;

/**
 * Lets the Conversation Dev Mock answer the persistence routes first in dev
 * and demo builds (`NEXT_PUBLIC_DEV_TWEAKS=1` marks a demo image); a real
 * production build statically drops the dynamic import, so fixtures never
 * reach production bundles — the same gate as the /api/billing routes.
 */
function withChatDevMock(
  handler: ChatDevMockHandler,
  real: ConversationRouteHandler
): ConversationRouteHandler {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PUBLIC_DEV_TWEAKS !== "1"
  ) {
    return real;
  }
  return async (request) => {
    const { chatDevMockResponse } = await import("../dev-fixtures");
    return chatDevMockResponse(handler, request, real);
  };
}

const handlers = createAssistantConversationHandlers({
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

/** Production wiring for the conversation routes, dev mock first. */
export const assistantConversationRouteHandlers = {
  ...handlers,
  messagesGet: withChatDevMock("messages", handlers.messagesGet),
  session: withChatDevMock("session", handlers.session),
  threads: withChatDevMock("threads", handlers.threads),
};
