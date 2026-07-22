import { normalizeAssistantNamespace } from "@/features/chat/persistence/types";
import {
  authorizeWorkspaceActor,
  encodedKubeconfigFromRequest,
  type VerifyKubeconfigNamespace,
} from "@/lib/request-kubeconfig-auth";
import {
  CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
  type GithubConnectionOwnerIdentity,
} from "./owner-identity";

export type GithubConnectionStatusLookup = (
  owner: GithubConnectionOwnerIdentity
) => Promise<object | null>;

export type GithubConnectionDelete = (
  owner: GithubConnectionOwnerIdentity
) => Promise<void>;

export type GithubRepositoryList = (
  owner: GithubConnectionOwnerIdentity
) => Promise<object[]>;

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
  encodedKubeconfig: string;
  requestedNamespace: string | undefined;
  verify?: VerifyKubeconfigNamespace;
}): Promise<GithubConnectionOwnerIdentity | Response> {
  const authorization = await authorizeWorkspaceActor({
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
    namespace: authorization.namespace,
    ownerIdentityVersion: CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
    workspaceActor: authorization.workspaceActor,
  };
}

function authorizeGithubConnectionRequest(
  request: Request,
  verify?: VerifyKubeconfigNamespace
): Promise<GithubConnectionOwnerIdentity | Response> {
  return authorizeGithubConnectionOwner({
    encodedKubeconfig: encodedKubeconfigFromRequest(request),
    requestedNamespace:
      new URL(request.url).searchParams.get("namespace")?.trim() || undefined,
    verify,
  });
}

async function authorizeGithubSessionRequest(
  request: Request,
  verify?: VerifyKubeconfigNamespace
): Promise<
  | {
      owner: GithubConnectionOwnerIdentity;
      returnPath: string | null;
    }
  | Response
> {
  const body = (await request.json().catch(() => null)) as {
    encodedKubeconfig?: unknown;
    namespace?: unknown;
    returnPath?: unknown;
  } | null;
  const namespace =
    typeof body?.namespace === "string" ? body.namespace.trim() : "";
  const owner = await authorizeGithubConnectionOwner({
    encodedKubeconfig:
      typeof body?.encodedKubeconfig === "string" ? body.encodedKubeconfig : "",
    requestedNamespace: namespace || undefined,
    verify,
  });
  return owner instanceof Response
    ? owner
    : {
        owner,
        returnPath:
          typeof body?.returnPath === "string" ? body.returnPath : null,
      };
}

export function createGithubConnectionStatusHandler(input: {
  getConnection: GithubConnectionStatusLookup;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const owner = await authorizeGithubConnectionRequest(request, input.verify);
    if (owner instanceof Response) {
      return owner;
    }
    const connection = await input.getConnection(owner);
    return Response.json({
      connection: publicConnectionStatus(connection),
    });
  };
}

export function createGithubRepositoryListHandler(input: {
  listRepositories: GithubRepositoryList;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const owner = await authorizeGithubConnectionRequest(request, input.verify);
    if (owner instanceof Response) {
      return owner;
    }
    try {
      return Response.json({ repos: await input.listRepositories(owner) });
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
  deleteConnection: GithubConnectionDelete;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const owner = await authorizeGithubConnectionRequest(request, input.verify);
    if (owner instanceof Response) {
      return owner;
    }
    await input.deleteConnection(owner);
    return Response.json({ connection: null });
  };
}

export function createGithubOAuthSessionHandler(input: {
  createSession: GithubOAuthSessionCreate;
  getBaseUrl: (request: Request) => string;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const authorization = await authorizeGithubSessionRequest(
      request,
      input.verify
    );
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
  createSession: GithubAppInstallSessionCreate;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const authorization = await authorizeGithubSessionRequest(
      request,
      input.verify
    );
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
