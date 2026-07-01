import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { fetchServerCredentials } from "@/lib/server-credentials";
import {
  getGithubAppInstallationMetadata,
  getGithubAppMetadata,
} from "./app-auth";
import { upsertGithubAppConnection } from "./connection-service";
import {
  clearInstallCookies,
  readCallbackCookies,
  readInstallSessionCookies,
  setAuthorizeCookies,
} from "./cookies";
import { authorizeGithubConnectionIdentity } from "./namespace-auth-core";
import { parseInstallNamespaceParam } from "./types";
import { buildInstallPopupCompleteUrl, getCallbackBaseUrl } from "./urls";

const TRAILING_SLASH_RE = /\/+$/;

function jsonError(
  error: string,
  description: string,
  status: number
): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status }
  );
}

async function githubAppInstallUrl(state: string): Promise<string> {
  const app = await getGithubAppMetadata();
  const url = new URL(
    `${app.htmlUrl.replace(TRAILING_SLASH_RE, "")}/installations/new`
  );
  url.searchParams.set("state", state);
  return url.toString();
}

/** Step 1 — persist namespace session and redirect to GitHub App installation. */
export async function startAuthorize(
  _request: Request,
  options: { namespace: string | null; returnPath: string | null }
): Promise<NextResponse> {
  const serverCredentials = await fetchServerCredentials();
  const { encodedKubeconfig, userId } = await readInstallSessionCookies();
  if (encodedKubeconfig == null || userId == null) {
    return jsonError(
      "forbidden",
      "GitHub App install session is required.",
      401
    );
  }
  const identity = authorizeGithubConnectionIdentity(
    options.namespace,
    userId,
    {
      serverEncodedKubeconfig: encodedKubeconfig,
      serverNamespace: serverCredentials.serverNamespace,
    }
  );
  if (!identity.ok) {
    return jsonError("forbidden", identity.error, identity.status);
  }

  const state = randomUUID();
  const response = NextResponse.redirect(await githubAppInstallUrl(state));
  setAuthorizeCookies(response, {
    namespace: identity.namespace,
    state,
    returnPath: options.returnPath,
    userId: identity.userId,
  });
  return response;
}

/** Provider returned `?error=...` — clean up cookies and redirect home. */
export async function handleProviderError(
  request: Request
): Promise<NextResponse> {
  const baseUrl = getCallbackBaseUrl(request);
  const { returnPath } = await readCallbackCookies();
  const response = NextResponse.redirect(
    buildInstallPopupCompleteUrl(baseUrl, returnPath)
  );
  clearInstallCookies(response);
  return response;
}

/** Step 2 — verify state, store namespace GitHub App installation, redirect. */
export async function completeAuthorization(
  request: Request,
  args: {
    installationId: string | null;
    setupAction: string | null;
    state: string | null;
  }
): Promise<NextResponse> {
  const { state, encodedKubeconfig, namespace, returnPath, userId } =
    await readCallbackCookies();
  if (!state || state !== args.state) {
    return jsonError(
      "invalid_state",
      "CSRF check failed. State mismatch or expired.",
      400
    );
  }
  const installationId = args.installationId?.trim() ?? "";
  if (installationId === "") {
    return jsonError(
      "missing_installation",
      "GitHub App installation ID was not returned.",
      400
    );
  }

  const serverCredentials = await fetchServerCredentials();
  const storedNamespace = parseInstallNamespaceParam(namespace ?? null);
  const identity = authorizeGithubConnectionIdentity(storedNamespace, userId, {
    serverEncodedKubeconfig:
      encodedKubeconfig ?? serverCredentials.serverEncodedKubeconfig,
    serverNamespace: serverCredentials.serverNamespace,
  });
  if (!identity.ok) {
    return jsonError("forbidden", identity.error, identity.status);
  }

  const installation = await getGithubAppInstallationMetadata(installationId);
  await upsertGithubAppConnection({
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    actorUserId: identity.userId,
    installationId,
    namespace: identity.namespace,
    repositorySelection: installation.repositorySelection,
  });

  const baseUrl = getCallbackBaseUrl(request);
  const response = NextResponse.redirect(
    buildInstallPopupCompleteUrl(baseUrl, returnPath)
  );
  clearInstallCookies(response);
  return response;
}
