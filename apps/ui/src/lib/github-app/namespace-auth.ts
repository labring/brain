import "server-only";

import { fetchServerCredentials } from "@/lib/server-credentials";
import {
  authorizeGithubConnectionIdentity,
  credentialsWithRequestKubeconfig,
  type GithubConnectionAuthorization,
} from "./namespace-auth-core";

export async function resolveGithubConnectionIdentity(
  request: Request,
  requestedNamespace: string | null | undefined,
  requestedUserId: string | null | undefined
): Promise<GithubConnectionAuthorization> {
  const credentials = await fetchServerCredentials();
  return authorizeGithubConnectionIdentity(
    requestedNamespace,
    requestedUserId,
    credentialsWithRequestKubeconfig(request, credentials)
  );
}
