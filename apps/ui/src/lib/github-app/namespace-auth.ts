import "server-only";

import {
  authorizeGithubConnectionIdentity,
  credentialsWithRequestKubeconfig,
  type GithubConnectionAuthorization,
} from "./namespace-auth-core";

export function resolveGithubConnectionIdentity(
  request: Request,
  requestedNamespace: string | null | undefined,
  requestedUserId: string | null | undefined
): Promise<GithubConnectionAuthorization> {
  return authorizeGithubConnectionIdentity(
    requestedNamespace,
    requestedUserId,
    credentialsWithRequestKubeconfig(request)
  );
}
