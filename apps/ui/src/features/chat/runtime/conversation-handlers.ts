import type { UIMessage } from "ai";
import type { AppTokenVerificationConfig } from "@/lib/app-token";
import type { ObserveIdentityFingerprint } from "@/lib/identity-fingerprint-core";
import {
  authorizePersonalResourceRequest,
  jsonError,
  supersededBindingResponse,
} from "@/lib/personal-resource-http";
import type { VerifyKubeconfigNamespace } from "@/lib/request-kubeconfig-auth";
import { verifiedPersonalResourceActor } from "@/lib/verified-personal-actor";
import {
  type AssistantConversationOwner,
  type AssistantSessionPayload,
  type AssistantThreadDTO,
  normalizeAssistantNamespace,
  type VerifiedAssistantConversationActor,
} from "../persistence/types";

export interface AssistantConversationHandlerDependencies {
  /**
   * Lazy re-key (ADR-0059): every verified conversation entry request first
   * adopts the actor's legacy crName-keyed rows into the uid owner.
   */
  adoptLegacyConversations: (
    actor: VerifiedAssistantConversationActor
  ) => Promise<void>;
  /** Test seam; defaults to `JWT_INTERNAL` from the env. */
  appTokenConfig?: AppTokenVerificationConfig | null;
  bootstrap: (
    owner: AssistantConversationOwner
  ) => Promise<AssistantSessionPayload>;
  list: (owner: AssistantConversationOwner) => Promise<AssistantThreadDTO[]>;
  /** Test seam; defaults to the region-local Identity Fingerprint store. */
  observeFingerprint?: ObserveIdentityFingerprint;
  read: (
    owner: AssistantConversationOwner,
    chatId: string
  ) => Promise<UIMessage[] | null>;
  verify?: VerifyKubeconfigNamespace;
}

function conversationNotFound(): Response {
  return jsonError({
    code: "assistant_conversation_not_found",
    message: "Assistant conversation not found.",
    status: 404,
  });
}

export function createAssistantConversationHandlers(
  dependencies: AssistantConversationHandlerDependencies
) {
  const authorize = async (
    request: Request
  ): Promise<
    | { ok: true; actor: VerifiedAssistantConversationActor }
    | { ok: false; response: Response }
  > => {
    const result = await authorizePersonalResourceRequest(request, {
      appTokenConfig: dependencies.appTokenConfig,
      normalizeNamespace: normalizeAssistantNamespace,
      observeFingerprint: dependencies.observeFingerprint,
      verify: dependencies.verify,
    });
    return result.ok
      ? { actor: verifiedPersonalResourceActor(result.authorization), ok: true }
      : result;
  };

  return {
    messagesGet: async (request: Request): Promise<Response> => {
      const chatId = new URL(request.url).searchParams.get("chatId")?.trim();
      if (!chatId) {
        return jsonError({
          code: "invalid_request",
          message: "chatId query parameter required",
          status: 400,
        });
      }
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }
      try {
        await dependencies.adoptLegacyConversations(authorization.actor);
        const messages = await dependencies.read(
          authorization.actor.owner,
          chatId
        );
        return messages == null
          ? conversationNotFound()
          : Response.json({ messages });
      } catch (error) {
        const superseded = supersededBindingResponse(error);
        if (superseded != null) {
          return superseded;
        }
        console.error("[api/chat/messages] persistence unavailable");
        return jsonError({
          code: "assistant_chat_unavailable",
          message: "Assistant chat persistence is unavailable.",
          status: 503,
        });
      }
    },
    session: async (request: Request): Promise<Response> => {
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }
      try {
        await dependencies.adoptLegacyConversations(authorization.actor);
        return Response.json(
          await dependencies.bootstrap(authorization.actor.owner)
        );
      } catch (error) {
        const superseded = supersededBindingResponse(error);
        if (superseded != null) {
          return superseded;
        }
        console.error("[api/chat/session] persistence unavailable");
        return jsonError({
          code: "assistant_chat_unavailable",
          message:
            "Could not load assistant session (database / DATABASE_URL).",
          status: 503,
        });
      }
    },
    threads: async (request: Request): Promise<Response> => {
      const authorization = await authorize(request);
      if (!authorization.ok) {
        return authorization.response;
      }

      try {
        await dependencies.adoptLegacyConversations(authorization.actor);
        const threads = await dependencies.list(authorization.actor.owner);
        return Response.json({ threads });
      } catch (error) {
        const superseded = supersededBindingResponse(error);
        if (superseded != null) {
          return superseded;
        }
        console.error("[api/chat/threads] persistence unavailable");
        return jsonError({
          code: "assistant_chat_unavailable",
          message:
            "Assistant chat persistence is unavailable (check DATABASE_URL).",
          status: 503,
        });
      }
    },
  };
}
