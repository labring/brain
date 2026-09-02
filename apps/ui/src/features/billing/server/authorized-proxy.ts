import type { z } from "zod";

import type {
  AccountServiceClient,
  AccountServiceErrorPayloadMapper,
} from "@/lib/account-service/client-core";
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
  mapAccountServiceError?: AccountServiceErrorPayloadMapper;
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

/** The 401 every billing write answers when the actor binding cannot be proven. */
function authenticationRequired(): Response {
  return Response.json(
    { error: "Authentication is required." },
    { status: 401 }
  );
}

/** Whether an authorization failure is a missing/invalid binding (→ 401) rather than a verdict. */
function isBindingFailure(
  authorization: Extract<WorkspaceActorAuthorization, { ok: false }>
): boolean {
  return (
    authorization.code.startsWith("app_token_") ||
    authorization.code === "workspace_actor_required"
  );
}

export type BillingActorAuthorization =
  | {
      ok: true;
      encodedKubeconfig: string;
      /** The workspace the actor was verified in — the only one a write may name. */
      namespace: string;
      /** Legacy platform user id; empty when the binding carries none. */
      userId: string;
      /** Bare global user UID (ADR-0059). */
      userUid: string;
    }
  | { ok: false; response: Response };

/**
 * The preamble every billing write shares: prove the workspace-actor binding
 * from the request's app token and kubeconfig, answer a missing binding with
 * 401 and a verdict with its own status, and require a global uid. Callers
 * decide whether they also need the legacy `userId`.
 */
export async function authorizeBillingActor(
  request: Request,
  authorizeWorkspaceActor: AuthorizeWorkspaceActor
): Promise<BillingActorAuthorization> {
  const encodedKubeconfig = encodedKubeconfigFromRequest(request);
  const authorization = await authorizeWorkspaceActor({
    appToken: appTokenFromRequest(request),
    encodedKubeconfig,
  });
  if (!authorization.ok) {
    return {
      ok: false,
      response: isBindingFailure(authorization)
        ? authenticationRequired()
        : Response.json(
            { error: authorization.message },
            { status: authorization.status }
          ),
    };
  }
  const userUid = authorization.actorBinding.userUid.trim();
  if (userUid === "") {
    return { ok: false, response: authenticationRequired() };
  }
  return {
    encodedKubeconfig,
    namespace: authorization.namespace,
    ok: true,
    userId: authorization.actorBinding.userId?.trim() ?? "",
    userUid,
  };
}

export function createAuthorizedBillingProxy(
  { authorizeWorkspaceActor, requestAccountService }: BillingProxyDependencies,
  config: BillingProxyConfig
) {
  return async function handler(request: Request): Promise<Response> {
    const actor = await authorizeBillingActor(request, authorizeWorkspaceActor);
    if (!actor.ok) {
      return actor.response;
    }
    // account-service still addresses the actor by the legacy id as well.
    const { encodedKubeconfig, userId, userUid } = actor;
    if (userId === "") {
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
        verifiedWorkspace: actor.namespace,
      });
      if (mapped.response != null) {
        return mapped.response;
      }
      body = mapped.body;
    }

    return await requestAccountService({
      actor: { userId, userUid },
      init: { body: JSON.stringify(body), method: "POST" },
      mapErrorPayload: config.mapAccountServiceError,
      pathname: config.pathname,
    });
  };
}
