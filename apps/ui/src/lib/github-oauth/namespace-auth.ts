import "server-only";

import { fetchServerCredentials } from "@/lib/server-credentials";
import {
  authorizeGithubConnectionNamespace,
  type GithubNamespaceAuthorization,
} from "./namespace-auth-core";

export async function resolveGithubConnectionNamespace(
  requestedNamespace: string | null | undefined
): Promise<GithubNamespaceAuthorization> {
  return authorizeGithubConnectionNamespace(
    requestedNamespace,
    await fetchServerCredentials()
  );
}
