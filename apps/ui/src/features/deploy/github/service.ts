import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  buildGithubOAuthAuthorizeUrl,
  exchangeGithubOAuthCode,
  getGithubAppInstallationMetadata,
  getGithubAppMetadata,
  getGithubUserLogin,
} from "./app-auth";
import {
  upsertGithubAppConnection,
  upsertGithubOauthConnection,
} from "./connection-service";
import {
  consumeGithubAppInstallSession,
  createGithubAppInstallSession,
} from "./install-session-service";
import { authorizeGithubConnectionIdentity } from "./namespace-auth-core";
import { parseInstallReturnPathParam } from "./types";
import { buildInstallPopupCompleteUrl, getCallbackBaseUrl } from "./urls";

const TRAILING_SLASH_RE = /\/+$/;
const OAUTH_SCOPE_SEPARATOR_RE = /[\s,]+/;
const REQUIRED_OAUTH_SCOPES = ["repo", "write:packages"] as const;

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

function githubOAuthCallbackUrl(baseUrl: string): string {
  return new URL(
    "/api/callback/github",
    `${baseUrl.replace(TRAILING_SLASH_RE, "")}/`
  ).toString();
}

function oauthScopeSet(scope: string): Set<string> {
  return new Set(
    scope
      .split(OAUTH_SCOPE_SEPARATOR_RE)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function assertRequiredOAuthScopes(scope: string): void {
  const granted = oauthScopeSet(scope);
  const missing = REQUIRED_OAUTH_SCOPES.filter((item) => !granted.has(item));
  if (missing.length > 0) {
    throw new Error(
      `GitHub OAuth token is missing required scopes: ${missing.join(", ")}.`
    );
  }
}

async function githubAppInstallUrl(state: string): Promise<string> {
  const app = await getGithubAppMetadata();
  const url = new URL(
    `${app.htmlUrl.replace(TRAILING_SLASH_RE, "")}/installations/new`
  );
  url.searchParams.set("state", state);
  return url.toString();
}

export async function createGithubOAuthSessionUrl(input: {
  baseUrl: string;
  encodedKubeconfig: string;
  namespace: string;
  returnPath: string | null;
  userId: string;
}): Promise<{ authorizeUrl: string; state: string }> {
  const identity = await authorizeGithubConnectionIdentity(
    input.namespace,
    input.userId,
    { serverEncodedKubeconfig: input.encodedKubeconfig }
  );
  if (!identity.ok) {
    throw new Error(identity.error);
  }

  const state = randomUUID();
  await createGithubAppInstallSession({
    namespace: identity.namespace,
    returnPath: parseInstallReturnPathParam(input.returnPath),
    state,
    userId: identity.userId,
  });
  return {
    authorizeUrl: buildGithubOAuthAuthorizeUrl({
      redirectUri: githubOAuthCallbackUrl(input.baseUrl),
      scopes: ["repo", "read:packages", "write:packages"],
      state,
    }),
    state,
  };
}

export async function createGithubAppInstallSessionUrl(input: {
  encodedKubeconfig: string;
  namespace: string;
  returnPath: string | null;
  userId: string;
}): Promise<{ installUrl: string; state: string }> {
  const identity = await authorizeGithubConnectionIdentity(
    input.namespace,
    input.userId,
    { serverEncodedKubeconfig: input.encodedKubeconfig }
  );
  if (!identity.ok) {
    throw new Error(identity.error);
  }

  const state = randomUUID();
  await createGithubAppInstallSession({
    namespace: identity.namespace,
    returnPath: parseInstallReturnPathParam(input.returnPath),
    state,
    userId: identity.userId,
  });
  return { installUrl: await githubAppInstallUrl(state), state };
}

/** Direct setup entry is rejected; install/configure must start from an authenticated Desktop SDK session. */
export function startAuthorize(): NextResponse {
  return jsonError(
    "install_session_required",
    "GitHub App installation or configuration must start from an authenticated Desktop SDK session.",
    401
  );
}

/** Provider returned `?error=...` — redirect back to the opener. */
export function handleProviderError(request: Request): NextResponse {
  const baseUrl = getCallbackBaseUrl(request);
  const response = NextResponse.redirect(
    buildInstallPopupCompleteUrl(baseUrl, null)
  );
  return response;
}

/** Verify setup state, store namespace GitHub App installation, redirect. */
export async function completeAuthorization(
  request: Request,
  args: {
    installationId: string | null;
    setupAction: string | null;
    state: string | null;
  }
): Promise<NextResponse> {
  const session = await consumeGithubAppInstallSession(args.state ?? "");
  if (session == null) {
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

  const installation = await getGithubAppInstallationMetadata(installationId);
  await upsertGithubAppConnection({
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    actorUserId: session.userId,
    installationId,
    namespace: session.namespace,
    repositorySelection: installation.repositorySelection,
  });

  const baseUrl = getCallbackBaseUrl(request);
  const response = NextResponse.redirect(
    buildInstallPopupCompleteUrl(baseUrl, session.returnPath, session.state)
  );
  return response;
}

export async function completeOAuthAuthorization(
  request: Request,
  args: {
    code: string | null;
    state: string | null;
  }
): Promise<NextResponse> {
  const session = await consumeGithubAppInstallSession(args.state ?? "");
  if (session == null) {
    return jsonError(
      "invalid_state",
      "CSRF check failed. State mismatch or expired.",
      400
    );
  }
  const code = args.code?.trim() ?? "";
  if (code === "") {
    return jsonError(
      "missing_code",
      "GitHub OAuth authorization code was not returned.",
      400
    );
  }

  const baseUrl = getCallbackBaseUrl(request);
  const token = await exchangeGithubOAuthCode({
    code,
    redirectUri: githubOAuthCallbackUrl(baseUrl),
  });
  assertRequiredOAuthScopes(token.scope);
  const githubLogin = await getGithubUserLogin(token.accessToken);
  await upsertGithubOauthConnection({
    githubLogin,
    namespace: session.namespace,
    token,
    userId: session.userId,
  });

  return NextResponse.redirect(
    buildInstallPopupCompleteUrl(baseUrl, session.returnPath, session.state)
  );
}
