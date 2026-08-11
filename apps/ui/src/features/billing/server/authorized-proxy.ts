import type { z } from "zod";

import type { AccountServiceClient } from "@/lib/account-service/client-core";
import { appTokenFromRequest } from "@/lib/app-token";
import {
  encodedKubeconfigFromRequest,
  type WorkspaceActorAuthorization,
} from "@/lib/request-kubeconfig-auth";

export type AuthorizeWorkspaceActor = (input: {
  appToken: string | undefined;
  encodedKubeconfig: string | undefined;
}) => Promise<WorkspaceActorAuthorization>;

export interface BillingProxyDependencies {
  authorizeWorkspaceActor: AuthorizeWorkspaceActor;
  requestAccountService: AccountServiceClient;
}

export interface BillingProxyConfig {
  invalidRequestMessage?: string;
  mapRequestBody?: (
    data: unknown,
    context: BillingProxyRequestContext
  ) => unknown;
  pathname: string;
  requestSchema?: z.ZodType;
}

interface BillingProxyRequestContext {
  encodedKubeconfig: string;
  verifiedWorkspace: string;
}

export class BillingProxyRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingProxyRequestError";
  }
}

function mapBillingRequestBody(
  config: BillingProxyConfig,
  data: unknown,
  context: BillingProxyRequestContext
): { body: unknown; response?: never } | { body?: never; response: Response } {
  try {
    return { body: config.mapRequestBody?.(data, context) ?? data };
  } catch (error) {
    if (error instanceof BillingProxyRequestError) {
      return {
        response: Response.json({ error: error.message }, { status: 400 }),
      };
    }
    throw error;
  }
}

function authenticationRequired(): Response {
  return Response.json(
    { error: "Authentication is required." },
    { status: 401 }
  );
}

function isBindingFailure(
  authorization: Extract<WorkspaceActorAuthorization, { ok: false }>
): boolean {
  return (
    authorization.code.startsWith("app_token_") ||
    authorization.code === "workspace_actor_required"
  );
}

export function createAuthorizedBillingProxy(
  { authorizeWorkspaceActor, requestAccountService }: BillingProxyDependencies,
  config: BillingProxyConfig
) {
  return async function handler(request: Request): Promise<Response> {
    const encodedKubeconfig = encodedKubeconfigFromRequest(request);
    const authorization = await authorizeWorkspaceActor({
      appToken: appTokenFromRequest(request),
      encodedKubeconfig,
    });
    if (!authorization.ok) {
      if (isBindingFailure(authorization)) {
        return authenticationRequired();
      }
      return Response.json(
        { error: authorization.message },
        { status: authorization.status }
      );
    }

    const userId = authorization.actorBinding.userId?.trim() ?? "";
    const userUid = authorization.actorBinding.userUid.trim();
    if (userId === "" || userUid === "") {
      return authenticationRequired();
    }

    let body: unknown = {};
    if (config.requestSchema != null) {
      const payload: unknown = await request.json().catch(() => null);
      const parsed = config.requestSchema.safeParse(payload);
      if (!parsed.success) {
        return Response.json(
          {
            error: config.invalidRequestMessage ?? "Invalid billing request.",
          },
          { status: 400 }
        );
      }
      const mapped = mapBillingRequestBody(config, parsed.data, {
        encodedKubeconfig,
        verifiedWorkspace: authorization.namespace,
      });
      if (mapped.response != null) {
        return mapped.response;
      }
      body = mapped.body;
    }

    return await requestAccountService({
      actor: { userId, userUid },
      init: { body: JSON.stringify(body), method: "POST" },
      pathname: config.pathname,
    });
  };
}
