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

const PUBLIC_CONNECTION_FIELDS = [
  "accountLogin",
  "accountType",
  "id",
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

export function createGithubConnectionStatusHandler(input: {
  getConnection: GithubConnectionStatusLookup;
  verify?: VerifyKubeconfigNamespace;
}): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestedNamespace = new URL(request.url).searchParams
      .get("namespace")
      ?.trim();
    const authorization = await authorizeWorkspaceActor({
      encodedKubeconfig: encodedKubeconfigFromRequest(request),
      expectedNamespace: requestedNamespace || undefined,
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
    if (!requestedNamespace) {
      return jsonError({
        code: "invalid_request",
        message: "Missing namespace.",
        status: 400,
      });
    }

    const connection = await input.getConnection({
      namespace: authorization.namespace,
      ownerIdentityVersion: CURRENT_GITHUB_OWNER_IDENTITY_VERSION,
      workspaceActor: authorization.workspaceActor,
    });
    return Response.json({
      connection: publicConnectionStatus(connection),
    });
  };
}
