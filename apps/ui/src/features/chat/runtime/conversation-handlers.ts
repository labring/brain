import type { UIMessage } from "ai";
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
} from "../persistence/types";
import { jsonError } from "./errors";

export interface AssistantConversationHandlerDependencies {
  bootstrap: (
    owner: AssistantConversationOwner
  ) => Promise<AssistantSessionPayload>;
  list: (owner: AssistantConversationOwner) => Promise<AssistantThreadDTO[]>;
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
    | { ok: true; owner: AssistantConversationOwner }
    | { ok: false; response: Response }
  > => {
    const authorization = await authorizeWorkspaceActor({
      encodedKubeconfig: encodedKubeconfigFromRequest(request),
      expectedNamespace: clientNamespace?.trim() || undefined,
      normalizeNamespace: normalizeAssistantNamespace,
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
      owner: {
        namespace: authorization.namespace,
        workspaceActor: authorization.workspaceActor,
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
        const messages = await dependencies.read(authorization.owner, chatId);
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
        return Response.json(await dependencies.bootstrap(authorization.owner));
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
        const threads = await dependencies.list(authorization.owner);
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
