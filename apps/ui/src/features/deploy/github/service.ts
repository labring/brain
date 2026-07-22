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
import type {
  GithubOAuthCallbackCancel,
  GithubOAuthCallbackComplete,
} from "./connection-http-handlers";
import {
  upsertGithubAppConnection,
  upsertGithubOauthConnectionInTransaction,
} from "./connection-service";
import {
  consumeAndCompleteGithubAuthorizationSession,
  consumeGithubAuthorizationSession,
  createGithubAuthorizationSession,
} from "./install-session-service";
import type { GithubConnectionOwnerIdentity } from "./owner-identity";
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
  owner: GithubConnectionOwnerIdentity;
  returnPath: string | null;
}): Promise<{ authorizeUrl: string; state: string }> {
  const state = await createGithubAuthorizationState(input);
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
  owner: GithubConnectionOwnerIdentity;
  returnPath: string | null;
}): Promise<{ installUrl: string; state: string }> {
  const state = await createGithubAuthorizationState(input);
  return { installUrl: await githubAppInstallUrl(state), state };
}

async function createGithubAuthorizationState(input: {
  owner: GithubConnectionOwnerIdentity;
  returnPath: string | null;
}): Promise<string> {
  const state = randomUUID();
  await createGithubAuthorizationSession({
    owner: input.owner,
    returnPath: parseInstallReturnPathParam(input.returnPath),
    state,
  });
  return state;
}

/** Direct setup entry is rejected; install/configure must start from an authenticated Desktop SDK session. */
export function startAuthorize(): NextResponse {
  return jsonError(
    "install_session_required",
    "GitHub App installation or configuration must start from an authenticated Desktop SDK session.",
    401
  );
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
  const session = await consumeGithubAuthorizationSession(args.state ?? "");
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
    installationId,
    namespace: session.namespace,
    repositorySelection: installation.repositorySelection,
    workspaceActor: session.workspaceActor,
  });

  const baseUrl = getCallbackBaseUrl(request);
  const response = NextResponse.redirect(
    buildInstallPopupCompleteUrl(baseUrl, session.returnPath, session.state)
  );
  return response;
}

export const completeOAuthAuthorization: GithubOAuthCallbackComplete = async (
  input
) => {
  const baseUrl = getCallbackBaseUrl(input.request);
  const session = await consumeAndCompleteGithubAuthorizationSession(
    input.state,
    async (authorization, transaction) => {
      const token = await exchangeGithubOAuthCode({
        code: input.code,
        redirectUri: githubOAuthCallbackUrl(baseUrl),
      });
      assertRequiredOAuthScopes(token.scope);
      const githubLogin = await getGithubUserLogin(token.accessToken);
      await upsertGithubOauthConnectionInTransaction(transaction, {
        githubLogin,
        owner: {
          namespace: authorization.namespace,
          ownerIdentityVersion: authorization.ownerIdentityVersion,
          workspaceActor: authorization.workspaceActor,
        },
        token,
      });
      return authorization;
    }
  );
  if (session == null) {
    return null;
  }

  return NextResponse.redirect(
    buildInstallPopupCompleteUrl(baseUrl, session.returnPath, session.state)
  );
};

export const cancelOAuthAuthorization: GithubOAuthCallbackCancel = async (
  input
) => {
  const session = await consumeGithubAuthorizationSession(input.state);
  if (session == null) {
    return null;
  }
  return NextResponse.redirect(
    buildInstallPopupCompleteUrl(
      getCallbackBaseUrl(input.request),
      session.returnPath,
      session.state
    )
  );
};
