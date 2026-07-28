import { normalizeAssistantNamespace } from "@/features/chat/persistence/types";
import {
  type AppTokenVerificationConfig,
  appTokenFromRequest,
} from "@/lib/app-token";
import {
  authorizeWorkspaceActor,
  encodedKubeconfigFromRequest,
  type VerifyKubeconfigNamespace,
} from "@/lib/request-kubeconfig-auth";
import {
  CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
  type GithubConnectionOwnerIdentity,
  type VerifiedGithubConnectionActor,
} from "./owner-identity";

export type GithubConnectionStatusLookup = (
  owner: GithubConnectionOwnerIdentity
) => Promise<object | null>;

/** Forgets the actor's connection across both generations (ADR-0057). */
export type GithubConnectionDelete = (
  actor: VerifiedGithubConnectionActor
) => Promise<void>;

export type GithubRepositoryList = (
  owner: GithubConnectionOwnerIdentity
) => Promise<object[]>;

/**
 * Lazy re-key (ADR-0059): every verified connection entry request first
 * adopts the actor's legacy generation-1 crName row into the uid owner.
 */
export type GithubLegacyConnectionAdoption = (
  actor: VerifiedGithubConnectionActor
) => Promise<void>;

export type GithubOAuthSessionCreate = (input: {
  baseUrl: string;
  owner: GithubConnectionOwnerIdentity;
  returnPath: string | null;
}) => Promise<{ authorizeUrl: string; state: string }>;

export type GithubAppInstallSessionCreate = (input: {
  owner: GithubConnectionOwnerIdentity;
  returnPath: string | null;
}) => Promise<{ installUrl: string; state: string }>;

export type GithubOAuthCallbackComplete = (input: {
  code: string;
  request: Request;
  state: string;
}) => Promise<Response | null>;

export type GithubOAuthCallbackCancel = (input: {
  request: Request;
  state: string;
}) => Promise<Response | null>;

export type GithubOAuthStateValidate = (state: string) => Promise<boolean>;

const PUBLIC_CONNECTION_FIELDS = [
  "accountLogin",
  "accountType",
  "installationId",
  "isAuthorized",
  "namespace",
  "repositorySelection",
  "updatedAt",
] as const;

function publicConnectionStatus(connection: object | null): object | null {
  if (connection == null) {
    return null;
  }
  const source = connection as Record<string, unknown>;
  const status: Record<string, unknown> = {};
  for (const field of PUBLIC_CONNECTION_FIELDS) {
    if (field in source) {
      status[field] = source[field];
    }
  }
  return status;
}

function jsonError(input: {
  code: string;
  message: string;
  status: number;
}): Response {
  return Response.json(
    { code: input.code, error: input.message },
    { status: input.status }
  );
}

async function authorizeGithubConnectionOwner(input: {
  appToken: string;
  appTokenConfig?: AppTokenVerificationConfig | null;
  encodedKubeconfig: string;
  requestedNamespace: string | undefined;
  verify?: VerifyKubeconfigNamespace;
}): Promise<VerifiedGithubConnectionActor | Response> {
  const authorization = await authorizeWorkspaceActor({
    appToken: input.appToken,
    appTokenConfig: input.appTokenConfig,
    encodedKubeconfig: input.encodedKubeconfig,
    expectedNamespace: input.requestedNamespace || undefined,
    normalizeNamespace: normalizeAssistantNamespace,
    verify: input.verify,
  });
  if (!authorization.ok) {
    return jsonError({
      code: authorization.code,
      message: authorization.message,
      status: authorization.status,
    });
  }
  if (!input.requestedNamespace) {
    return jsonError({
      code: "invalid_request",
      message: "Missing namespace.",
      status: 400,
    });
  }
  return {
    legacyWorkspaceActor: authorization.workspaceActor,
    owner: {
      namespace: authorization.namespace,
      ownerIdentityVersion: CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
      userUid: authorization.actorBinding.userUid,
    },
  };
}

interface GithubConnectionAuthorizationOptions {
  /** Test seam; defaults to `JWT_INTERNAL` + `REGION_UID` from the env. */
  appTokenConfig?: AppTokenVerificationConfig | null;
  verify?: VerifyKubeconfigNamespace;
}

function authorizeGithubConnectionRequest(
  request: Request,
  options: GithubConnectionAuthorizationOptions
): Promise<VerifiedGithubConnectionActor | Response> {
  return authorizeGithubConnectionOwner({
    appToken: appTokenFromRequest(request),
    appTokenConfig: options.appTokenConfig,
    encodedKubeconfig: encodedKubeconfigFromRequest(request),
    requestedNamespace:
      new URL(request.url).searchParams.get("namespace")?.trim() || undefined,
    verify: options.verify,
  });
}

async function authorizeGithubSessionRequest(
  request: Request,
  options: GithubConnectionAuthorizationOptions
): Promise<
  | {
      owner: GithubConnectionOwnerIdentity;
      returnPath: string | null;
    }
  | Response
> {
  const appToken = appTokenFromRequest(request);
  const body = (await request.json().catch(() => null)) as {
    encodedKubeconfig?: unknown;
    namespace?: unknown;
    returnPath?: unknown;
  } | null;
  const namespace =
    typeof body?.namespace === "string" ? body.namespace.trim() : "";
  const actor = await authorizeGithubConnectionOwner({
    appToken,
    appTokenConfig: options.appTokenConfig,
    encodedKubeconfig:
      typeof body?.encodedKubeconfig === "string" ? body.encodedKubeconfig : "",
    requestedNamespace: namespace || undefined,
    verify: options.verify,
  });
  return actor instanceof Response
    ? actor
    : {
        owner: actor.owner,
        returnPath:
          typeof body?.returnPath === "string" ? body.returnPath : null,
      };
}

export function createGithubConnectionStatusHandler(input: {
  adoptLegacyConnection: GithubLegacyConnectionAdoption;
  appTokenConfig?: AppTokenVerificationConfig | null;
  getConnection: GithubConnectionStatusLookup;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const actor = await authorizeGithubConnectionRequest(request, input);
    if (actor instanceof Response) {
      return actor;
    }
    await input.adoptLegacyConnection(actor);
    const connection = await input.getConnection(actor.owner);
    return Response.json({
      connection: publicConnectionStatus(connection),
    });
  };
}

export function createGithubRepositoryListHandler(input: {
  adoptLegacyConnection: GithubLegacyConnectionAdoption;
  appTokenConfig?: AppTokenVerificationConfig | null;
  listRepositories: GithubRepositoryList;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const actor = await authorizeGithubConnectionRequest(request, input);
    if (actor instanceof Response) {
      return actor;
    }
    await input.adoptLegacyConnection(actor);
    try {
      return Response.json({
        repos: await input.listRepositories(actor.owner),
      });
    } catch (error) {
      return jsonError({
        code: "github_connection_required",
        message:
          error instanceof Error
            ? error.message
            : "GitHub OAuth connection is not authorized.",
        status: 409,
      });
    }
  };
}

export function createGithubConnectionDeleteHandler(input: {
  appTokenConfig?: AppTokenVerificationConfig | null;
  deleteConnection: GithubConnectionDelete;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const actor = await authorizeGithubConnectionRequest(request, input);
    if (actor instanceof Response) {
      return actor;
    }
    // Disconnect forgets both the uid-keyed row and any inert legacy row
    // (ADR-0057) — deleting only the current owner would let a later entry
    // request adopt the legacy row and revive a forgotten authorization.
    await input.deleteConnection(actor);
    return Response.json({ connection: null });
  };
}

export function createGithubOAuthSessionHandler(input: {
  appTokenConfig?: AppTokenVerificationConfig | null;
  createSession: GithubOAuthSessionCreate;
  getBaseUrl: (request: Request) => string;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const authorization = await authorizeGithubSessionRequest(request, input);
    if (authorization instanceof Response) {
      return authorization;
    }
    return Response.json(
      await input.createSession({
        baseUrl: input.getBaseUrl(request),
        ...authorization,
      })
    );
  };
}

export function createGithubAppInstallSessionHandler(input: {
  appTokenConfig?: AppTokenVerificationConfig | null;
  createSession: GithubAppInstallSessionCreate;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const authorization = await authorizeGithubSessionRequest(request, input);
    if (authorization instanceof Response) {
      return authorization;
    }
    return Response.json({
      ...(await input.createSession(authorization)),
      namespace: authorization.owner.namespace,
    });
  };
}

export function createGithubOAuthCallbackHandler(input: {
  cancelAuthorization: GithubOAuthCallbackCancel;
  completeAuthorization: GithubOAuthCallbackComplete;
  validateState: GithubOAuthStateValidate;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const searchParams = new URL(request.url).searchParams;
    const state = searchParams.get("state")?.trim() ?? "";
    if (state === "") {
      return invalidGithubOAuthState();
    }
    if (!(await input.validateState(state))) {
      return invalidGithubOAuthState();
    }
    const callback = searchParams.has("error")
      ? input.cancelAuthorization({ request, state })
      : completeGithubOAuthCallback(input, request, state, searchParams);
    const response = await callback;
    return response ?? invalidGithubOAuthState();
  };
}

function completeGithubOAuthCallback(
  input: { completeAuthorization: GithubOAuthCallbackComplete },
  request: Request,
  state: string,
  searchParams: URLSearchParams
): Promise<Response | null> | Response {
  const code = searchParams.get("code")?.trim() ?? "";
  if (code === "") {
    return jsonError({
      code: "missing_code",
      message: "GitHub OAuth authorization code was not returned.",
      status: 400,
    });
  }
  return input.completeAuthorization({ code, request, state });
}

function invalidGithubOAuthState(): Response {
  return jsonError({
    code: "invalid_oauth_state",
    message: "OAuth state is missing, expired, invalid, or already consumed.",
    status: 400,
  });
}
