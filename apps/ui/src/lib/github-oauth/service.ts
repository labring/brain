import "server-only";

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import {
  KUBECONFIG_DEFAULT_NAMESPACE,
  namespaceFromKubeconfigText,
} from "@/lib/chat-runtime/kubeconfig-namespace";
import { fetchServerCredentials } from "@/lib/server-credentials";
import { fetchGithubLogin, upsertGithubConnection } from "./connection-service";
import {
  clearOAuthCookies,
  readCallbackCookies,
  setAuthorizeCookies,
} from "./cookies";
import { applyGhcrSecretIfAuthenticated } from "./ghcr-secret";
import { generatePKCE } from "./pkce";
import { GITHUB_OAUTH_SCOPES, parseOAuthNamespaceParam } from "./types";
import {
  buildCallbackUri,
  buildOAuthPopupCompleteUrl,
  getCallbackBaseUrl,
} from "./urls";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";

type TokenResult =
  | { access_token: string; scope?: string; token_type?: string }
  | { error: string; error_description?: string };

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

function parseNamespaceFromEncodedKubeconfig(
  serverEncodedKubeconfig: string | undefined
): string {
  const raw = serverEncodedKubeconfig?.trim();
  if (!raw) {
    return KUBECONFIG_DEFAULT_NAMESPACE;
  }
  try {
    return (
      namespaceFromKubeconfigText(decodeURIComponent(raw)) ??
      KUBECONFIG_DEFAULT_NAMESPACE
    );
  } catch {
    return KUBECONFIG_DEFAULT_NAMESPACE;
  }
}

async function exchangeCodeForToken(args: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResult> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!(clientId && clientSecret)) {
    return {
      error: "server_error",
      error_description: "GitHub OAuth app not configured",
    };
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
  });
  const res = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data = (await res.json()) as TokenResult & {
    error_description?: string;
  };
  if (!res.ok) {
    return {
      error: "token_exchange_failed",
      error_description: data.error_description ?? res.statusText,
    };
  }
  return data;
}

/** Step 1 — generate PKCE, persist cookies, redirect to GitHub authorize. */
export function startAuthorize(
  request: Request,
  options: { namespace: string | null; returnPath: string | null }
): NextResponse {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) {
    return jsonError("server_error", "GitHub OAuth app not configured", 500);
  }
  const state = randomUUID();
  const { verifier, challenge } = generatePKCE();
  const baseUrl = getCallbackBaseUrl(request);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: buildCallbackUri(baseUrl),
    scope: GITHUB_OAUTH_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const response = NextResponse.redirect(
    `${GITHUB_AUTHORIZE_URL}?${params.toString()}`
  );
  setAuthorizeCookies(response, {
    namespace: options.namespace,
    state,
    codeVerifier: verifier,
    returnPath: options.returnPath,
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
    buildOAuthPopupCompleteUrl(baseUrl, returnPath)
  );
  clearOAuthCookies(response);
  return response;
}

/** Step 2 — verify state, exchange code, apply GHCR secret, redirect. */
export async function completeAuthorization(
  request: Request,
  args: { code: string; state: string | null }
): Promise<NextResponse> {
  const { state, codeVerifier, namespace, returnPath } =
    await readCallbackCookies();
  if (!state || state !== args.state) {
    return jsonError(
      "invalid_state",
      "CSRF check failed. State mismatch or expired.",
      400
    );
  }
  const baseUrl = getCallbackBaseUrl(request);
  const data = await exchangeCodeForToken({
    code: args.code,
    codeVerifier: codeVerifier ?? "",
    redirectUri: buildCallbackUri(baseUrl),
  });
  if ("error" in data) {
    const status = data.error === "server_error" ? 500 : 400;
    return jsonError(
      data.error,
      data.error_description ?? "Token exchange failed",
      status
    );
  }
  const { serverEncodedKubeconfig } = await fetchServerCredentials();
  const storedNamespace = parseOAuthNamespaceParam(namespace ?? null);
  const githubLogin = await fetchGithubLogin(data.access_token);
  await upsertGithubConnection({
    accessToken: data.access_token,
    githubLogin,
    namespace:
      storedNamespace ??
      parseNamespaceFromEncodedKubeconfig(serverEncodedKubeconfig),
    scope: data.scope,
    tokenType: data.token_type,
  });
  await applyGhcrSecretIfAuthenticated(serverEncodedKubeconfig, {
    githubLogin,
    token: data.access_token,
  });
  const response = NextResponse.redirect(
    buildOAuthPopupCompleteUrl(baseUrl, returnPath)
  );
  clearOAuthCookies(response);
  return response;
}
