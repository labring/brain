import type { UIMessage } from "ai";
import {
  type AppTokenVerificationConfig,
  appTokenFromRequest,
} from "@/lib/app-token";
import type { ObserveIdentityFingerprint } from "@/lib/identity-fingerprint-core";
import {
  authorizeWorkspaceActor,
  encodedKubeconfigFromRequest,
  type VerifyKubeconfigNamespace,
} from "@/lib/request-kubeconfig-auth";
import {
  type AssistantConversationOwner,
  type AssistantSessionPayload,
  type AssistantThreadDTO,
  normalizeAssistantNamespace,
  type VerifiedAssistantConversationActor,
} from "../persistence/types";
import { jsonError } from "./errors";

export interface AssistantConversationHandlerDependencies {
  /**
   * Lazy re-key (ADR-0059): every verified conversation entry request first
   * adopts the actor's legacy crName-keyed rows into the uid owner.
   */
  adoptLegacyConversations: (
    actor: VerifiedAssistantConversationActor
  ) => Promise<void>;
  /** Test seam; defaults to `JWT_INTERNAL` + `REGION_UID` from the env. */
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
  return jsonError("Assistant conversation not found.", 404);
}

export function createAssistantConversationHandlers(
  dependencies: AssistantConversationHandlerDependencies
) {
  const authorize = async (
    request: Request,
    clientNamespace = new URL(request.url).searchParams.get("namespace")
  ): Promise<
    | { ok: true; actor: VerifiedAssistantConversationActor }
    | { ok: false; response: Response }
  > => {
    const authorization = await authorizeWorkspaceActor({
      appToken: appTokenFromRequest(request),
      appTokenConfig: dependencies.appTokenConfig,
      encodedKubeconfig: encodedKubeconfigFromRequest(request),
      expectedNamespace: clientNamespace?.trim() || undefined,
      normalizeNamespace: normalizeAssistantNamespace,
      observeFingerprint: dependencies.observeFingerprint,
      verify: dependencies.verify,
    });
    if (!authorization.ok) {
      return {
        ok: false,
        response: jsonError(authorization.message, authorization.status),
      };
    }
    return {
      ok: true,
      actor: {
        legacyWorkspaceActor: authorization.workspaceActor,
        owner: {
          namespace: authorization.namespace,
          workspaceActor: authorization.actorBinding.userUid,
        },
      },
    };
  };

  return {
    messagesGet: async (request: Request): Promise<Response> => {
      const chatId = new URL(request.url).searchParams.get("chatId")?.trim();
      if (!chatId) {
        return jsonError("chatId query parameter required", 400);
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
      } catch {
        console.error("[api/chat/messages] persistence unavailable");
        return jsonError("Assistant chat persistence is unavailable.", 503);
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
      } catch {
        console.error("[api/chat/session] persistence unavailable");
        return jsonError(
          "Could not load assistant session (database / DATABASE_URL).",
          503
        );
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
      } catch {
        console.error("[api/chat/threads] persistence unavailable");
        return jsonError(
          "Assistant chat persistence is unavailable (check DATABASE_URL).",
          503
        );
      }
    },
  };
}
